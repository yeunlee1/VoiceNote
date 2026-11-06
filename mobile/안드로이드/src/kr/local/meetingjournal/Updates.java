// 휴대폰 앱의 업데이트를 맡는다. 깃허브 최신 릴리즈를 확인하고, 서명한 목록과 같은 APK를 받아 두었다가, 사람이 누르면 시스템 설치 화면으로 넘긴다.
package kr.local.meetingjournal;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import org.json.JSONObject;
import java.io.*;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.cert.CertificateFactory;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class Updates {
    interface Opener { HttpURLConnection open(URL url) throws IOException; }
    // 기기 시험(AndroidChecks)이 실제 깃허브 대신 시험 응답을 넣을 때만 바꾼다. 앱에서는 바꾸지 않는다.
    static volatile Opener opener = url -> (HttpURLConnection) url.openConnection();
    // 확인·받기는 화면 요청을 처리하는 작업 스레드를 막지 않도록 따로 돈다.
    private static final ExecutorService network = Executors.newSingleThreadExecutor();
    private static final long RECHECK_GAP = 10_000;
    private static final String DIRECT = UpdateRules.DIRECT;

    private static String status = "idle", version, publishedAt, errorCode, errorMessage;
    private static long size, received, checkedAt;
    private static boolean working;
    private static UpdateRules.Release release;
    private static UpdateRules.Manifest manifest;
    private static File apkFile;
    // 시스템 설치 확인 화면(STATUS_PENDING_USER_ACTION)이다. 앱이 앞에 있을 때만 열고, 아니면 돌아왔을 때 '설치 계속'으로 연다.
    private static volatile Intent confirm;
    private static volatile int session = -1;
    private static volatile WeakReference<Activity> resumed = new WeakReference<>(null);

    private Updates() {}

    // 기기 시험이 상태를 처음으로 돌려 여러 경우를 차례로 볼 때만 쓴다.
    static synchronized void resetForTest() {
        status = "idle"; version = null; publishedAt = null; errorCode = null; errorMessage = null; size = 0; received = 0; checkedAt = 0; working = false;
        release = null; manifest = null; apkFile = null; confirm = null; session = -1;
    }
    // 확인·받기가 끝날 때까지 기다린다. 기기 시험만 쓴다.
    static void awaitIdleForTest(long millis) throws InterruptedException {
        long end = System.currentTimeMillis() + millis;
        while (System.currentTimeMillis() < end) { synchronized (Updates.class) { if (!working) return; } Thread.sleep(50); }
    }
    static void resumed(Activity activity) { resumed = new WeakReference<>(activity); }
    static void paused(Activity activity) { if (resumed.get() == activity) resumed = new WeakReference<>(null); }
    // 설치 확인을 기다리는 동안에는 새 녹음·분석을 받지 않는다.
    static synchronized boolean installing() { return "confirming".equals(status); }

    static String currentVersion(Context context) {
        try { return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; } catch (Exception ex) { return ""; }
    }
    @SuppressWarnings("deprecation")
    static long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    static long currentCode(Context context) {
        try { return versionCode(context.getPackageManager().getPackageInfo(context.getPackageName(), 0)); } catch (Exception ex) { return Long.MAX_VALUE; }
    }

    // 업데이트 목록은 이 앱과 같은 개인 서명 키로 서명한다. 열쇠는 설치된 이 앱의 서명 인증서에서 꺼낸다.
    @SuppressWarnings("deprecation")
    static PublicKey ownKey(Context context) throws IOException {
        try {
            PackageManager manager = context.getPackageManager();
            Signature[] signers;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                signers = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
            } else signers = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES).signatures;
            if (signers == null || signers.length != 1) throw new IOException("서명 인증서가 하나가 아닙니다.");
            return CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(signers[0].toByteArray())).getPublicKey();
        } catch (IOException ex) { throw ex; } catch (Exception ex) { throw new IOException("이 앱의 서명 인증서를 읽지 못했습니다."); }
    }

    static synchronized JSONObject snapshot(Context context) throws Exception {
        boolean permission = "ready".equals(status) && Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls();
        JSONObject error = errorMessage == null ? null : new JSONObject().put("code", errorCode).put("message", errorMessage);
        return new JSONObject().put("supported", true).put("currentVersion", currentVersion(context)).put("status", status)
            .put("version", version == null ? JSONObject.NULL : version).put("publishedAt", publishedAt == null ? JSONObject.NULL : publishedAt)
            .put("size", size).put("received", received).put("error", error == null ? JSONObject.NULL : error)
            .put("needsPermission", permission).put("canContinue", confirm != null && "confirming".equals(status)).put("pageUrl", UpdateRules.RELEASE_PAGE);
    }
    private static synchronized void set(String next, String code, String message) { status = next; errorCode = code; errorMessage = message; }

    // 화면이 처음 상태를 물을 때 한 번만 확인을 시작한다. force는 '다시 확인'이고 10초 안에는 반복하지 않는다.
    static synchronized void check(Context context, boolean force) {
        if (working || "downloading".equals(status) || "ready".equals(status) || "confirming".equals(status)) return;
        if (!force && !"idle".equals(status)) return;
        if (force && System.currentTimeMillis() - checkedAt < RECHECK_GAP) return;
        Context app = context.getApplicationContext();
        working = true;
        set("checking", null, null);
        network.submit(() -> runCheck(app));
    }

    private static HttpURLConnection open(Context context, String url, String accept) throws IOException {
        HttpURLConnection connection = opener.open(new URL(url));
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", accept);
        connection.setRequestProperty("User-Agent", "VoiceNote/" + currentVersion(context) + " (Android)");
        connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
        return connection;
    }
    // 리디렉션이 끝난 최종 주소도 HTTPS여야 한다.
    private static void httpsOnly(HttpURLConnection connection, String code) throws UpdateRules.Failure {
        if (!"https".equalsIgnoreCase(connection.getURL().getProtocol())) throw new UpdateRules.Failure(code, "안전한 주소(HTTPS)가 아니어서 받지 않았습니다. " + DIRECT);
    }
    private static byte[] read(HttpURLConnection connection, int limit) throws IOException {
        try (InputStream in = connection.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int count; (count = in.read(buffer)) != -1; ) {
                out.write(buffer, 0, count);
                if (out.size() > limit) throw new UpdateRules.Failure("UPDATE_CHECK_FAILED", "새 버전을 확인하지 못했습니다. 잠시 뒤 다시 확인을 눌러 주세요.");
            }
            return out.toByteArray();
        }
    }
    private static UpdateRules.Failure checkFailed() { return new UpdateRules.Failure("UPDATE_CHECK_FAILED", "새 버전을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 확인을 눌러 주세요."); }

    private static void runCheck(Context context) {
        try {
            String current = currentVersion(context);
            HttpURLConnection api = open(context, UpdateRules.RELEASE_API, "application/vnd.github+json");
            int code = api.getResponseCode();
            if (code == 404) { finish("latest", null, null, null, null, null); return; }
            if (code == 403 || code == 429) throw new UpdateRules.Failure("UPDATE_RATE_LIMITED", "깃허브 확인 횟수 제한에 걸렸습니다. 잠시 뒤 다시 확인을 눌러 주세요.");
            if (code != 200) throw checkFailed();
            httpsOnly(api, "UPDATE_CHECK_FAILED");
            UpdateRules.Release found = UpdateRules.readRelease(new String(read(api, UpdateRules.RELEASE_LIMIT), StandardCharsets.UTF_8), current);
            if ("latest".equals(found.status)) { finish("latest", null, null, null, null, null); return; }
            if ("manual".equals(found.status)) { finish("manual", found, null, "UPDATE_MANUAL", found.reason, null); return; }
            HttpURLConnection list = open(context, found.manifest.url, "application/octet-stream");
            if (list.getResponseCode() != 200) throw checkFailed();
            httpsOnly(list, "UPDATE_CHECK_FAILED");
            byte[] bytes = read(list, UpdateRules.MANIFEST_LIMIT);
            UpdateRules.Manifest verified;
            try {
                verified = UpdateRules.verifyManifest(bytes, found.version, ownKey(context));
                UpdateRules.matchAsset(verified, found.apk);
                if (verified.versionCode <= currentCode(context)) throw new UpdateRules.Failure("UPDATE_MANIFEST_INVALID", "새 버전 번호가 지금 앱보다 높지 않습니다. " + DIRECT);
            } catch (UpdateRules.Failure failure) {
                // 서명·형식이 맞지 않으면 APK를 받지 않는다. 사람이 깃허브에서 직접 확인하도록 안내만 남긴다.
                finish("manual", found, null, failure.code, failure.getMessage(), null);
                return;
            }
            finish("available", found, verified, null, null, null);
        } catch (UpdateRules.Failure failure) {
            finish("unknown", null, null, failure.code, failure.getMessage(), null);
        } catch (Exception ex) {
            finish("unknown", null, null, "UPDATE_CHECK_FAILED", checkFailed().getMessage(), null);
        }
    }
    private static synchronized void finish(String next, UpdateRules.Release found, UpdateRules.Manifest verified, String code, String message, File file) {
        release = found; manifest = verified; apkFile = file;
        version = found == null ? null : found.version; publishedAt = found == null ? null : found.publishedAt;
        size = verified == null ? 0 : verified.apkSize; received = 0;
        set(next, code, message);
        working = false;
        checkedAt = System.currentTimeMillis();
    }

    static synchronized JSONObject download(Context context) throws Exception {
        if ("downloading".equals(status) || "ready".equals(status) || "confirming".equals(status)) return snapshot(context);
        if (!"available".equals(status) || manifest == null || working) throw new UpdateRules.Failure("UPDATE_NOT_AVAILABLE", "받을 새 버전이 없습니다. 다시 확인을 눌러 주세요.");
        Context app = context.getApplicationContext();
        working = true;
        received = 0;
        set("downloading", null, null);
        UpdateRules.Release found = release;
        UpdateRules.Manifest verified = manifest;
        network.submit(() -> runDownload(app, found, verified));
        return snapshot(context);
    }

    private static void runDownload(Context context, UpdateRules.Release found, UpdateRules.Manifest verified) {
        File folder = new File(context.getCacheDir(), "업데이트");
        File part = new File(folder, verified.apkName + ".part"), file = new File(folder, verified.apkName);
        try {
            clear(folder);
            if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("임시 폴더를 만들지 못했습니다.");
            HttpURLConnection connection = open(context, found.apk.url, "application/octet-stream");
            if (connection.getResponseCode() != 200) throw new UpdateRules.Failure("UPDATE_DOWNLOAD_FAILED", "APK를 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 받아 주세요.");
            httpsOnly(connection, "UPDATE_DOWNLOAD_FAILED");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[65536];
                for (int count; (count = in.read(buffer)) != -1; ) {
                    total += count;
                    if (total > verified.apkSize) throw mismatch();
                    digest.update(buffer, 0, count);
                    out.write(buffer, 0, count);
                    synchronized (Updates.class) { received = total; }
                }
            }
            if (total != verified.apkSize || !hex(digest.digest()).equals(verified.apkSha256)) throw mismatch();
            if (!part.renameTo(file)) throw new IOException("받은 파일을 옮기지 못했습니다.");
            // APK 안의 패키지 이름과 버전 번호가 이 앱의 다음 버전인지 본다. 설치할 때 운영체제가 같은 서명인지도 다시 확인한다.
            PackageInfo info = context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), 0);
            if (info == null || !context.getPackageName().equals(info.packageName) || versionCode(info) != verified.versionCode || versionCode(info) <= currentCode(context))
                throw new UpdateRules.Failure("UPDATE_FILE_MISMATCH", "받은 APK가 이 앱의 새 버전이 아닙니다. " + DIRECT);
            synchronized (Updates.class) { apkFile = file; received = total; set("ready", null, null); working = false; }
        } catch (Exception ex) {
            clear(folder);
            String code = ex instanceof UpdateRules.Failure ? ((UpdateRules.Failure) ex).code : "UPDATE_DOWNLOAD_FAILED";
            String message = ex instanceof UpdateRules.Failure ? ex.getMessage() : "APK를 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 받아 주세요.";
            synchronized (Updates.class) { apkFile = null; received = 0; set("available", code, message); working = false; }
        }
    }
    private static UpdateRules.Failure mismatch() { return new UpdateRules.Failure("UPDATE_FILE_MISMATCH", "받은 APK가 업데이트 정보와 다릅니다. 다시 받거나 " + DIRECT); }
    private static void clear(File folder) {
        File[] files = folder.listFiles();
        if (files != null) for (File file : files) if (file.isFile()) file.delete();
    }
    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return out.toString();
    }

    // 받은 APK를 설치 세션으로 넘긴다. 설치 허용이 꺼져 있으면 넘기지 않고 화면이 설정으로 안내한다. 마지막 '업데이트'는 사람이 시스템 화면에서 누른다.
    static JSONObject install(Context context) throws Exception {
        UpdateRules.Manifest verified;
        File file;
        synchronized (Updates.class) {
            if (!"ready".equals(status) || apkFile == null || manifest == null) throw new UpdateRules.Failure("UPDATE_NOT_READY", "설치할 업데이트가 아직 준비되지 않았습니다.");
            if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) return snapshot(context);
            verified = manifest;
            file = apkFile;
            set("confirming", null, null);
        }
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        // 앞서 남은 이 앱의 설치 세션은 버리고 새 세션 하나만 쓴다.
        for (PackageInstaller.SessionInfo old : installer.getMySessions()) {
            try { installer.abandonSession(old.getSessionId()); } catch (Exception ignored) {}
        }
        int id = -1;
        try {
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            params.setSize(file.length());
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
            id = installer.createSession(params);
            try (PackageInstaller.Session target = installer.openSession(id)) {
                // 세션에 쓰면서 해시를 다시 계산해, 받은 뒤 바뀐 파일을 넘기지 않는다.
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream in = new FileInputStream(file); OutputStream out = target.openWrite("base.apk", 0, file.length())) {
                    byte[] buffer = new byte[65536];
                    for (int count; (count = in.read(buffer)) != -1; ) { digest.update(buffer, 0, count); out.write(buffer, 0, count); }
                    target.fsync(out);
                }
                if (file.length() != verified.apkSize || !hex(digest.digest()).equals(verified.apkSha256)) throw mismatch();
                Intent callback = new Intent(context, UpdateReceiver.class).setAction(UpdateReceiver.ACTION);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                // 시스템은 commit이 돌아오기 전에도 메인 스레드로 확인 화면이나 결과를 보낼 수 있다. 이 세션의 콜백을 받을 준비를 commit 전에 끝낸다.
                session = id;
                confirm = null;
                target.commit(PendingIntent.getBroadcast(context, id, callback, flags).getIntentSender());
            }
            return snapshot(context);
        } catch (Exception ex) {
            // 커밋하지 못한 세션의 늦은 콜백은 받지 않는다.
            session = -1;
            confirm = null;
            if (id != -1) try { installer.abandonSession(id); } catch (Exception ignored) {}
            boolean changed = ex instanceof UpdateRules.Failure;
            synchronized (Updates.class) {
                if (changed) { clear(file.getParentFile()); apkFile = null; received = 0; set("available", ((UpdateRules.Failure) ex).code, ex.getMessage()); }
                else set("ready", "UPDATE_INSTALL_FAILED", "설치 화면을 열지 못했습니다. 다시 설치를 눌러 주세요.");
            }
            throw ex instanceof UpdateRules.Failure ? ex : new UpdateRules.Failure("UPDATE_INSTALL_FAILED", "설치 화면을 열지 못했습니다. 다시 설치를 눌러 주세요.");
        }
    }

    // 수신기가 받은 사람 확인 화면이다. 앱 화면이 앞에 있으면 그 화면이 바로 열고, 아니면 보관만 한다(백그라운드 활동 시작 제한).
    static void pendingConfirm(int id, Intent intent) {
        if (intent == null || id != session) return;
        confirm = intent;
        Activity activity = resumed.get();
        if (activity != null && !activity.isFinishing()) activity.runOnUiThread(() -> openConfirm(activity));
    }
    static boolean openConfirm(Activity activity) {
        Intent intent = confirm;
        if (intent == null || !"confirming".equals(status)) return false;
        try { activity.startActivity(intent); return true; } catch (Exception ex) { return false; }
    }

    // 설치 결과를 사람이 읽을 문장으로 바꾼다. 공개된 상태값이 알려 주는 범위까지만 말한다.
    static void finished(int id, int result, String detail) {
        if (id != session) return;
        confirm = null;
        if (result == PackageInstaller.STATUS_SUCCESS) { synchronized (Updates.class) { set("installed", null, null); } return; }
        String message;
        switch (result) {
            case PackageInstaller.STATUS_FAILURE_ABORTED: message = "설치가 취소되거나 중단되었습니다. 다시 설치를 눌러 주세요."; break;
            case PackageInstaller.STATUS_FAILURE_BLOCKED: message = "기기 설정이나 관리 정책이 설치를 막았습니다. 설정을 확인한 뒤 다시 시도하세요."; break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT: message = "지금 설치된 앱과 맞지 않아 설치하지 못했습니다. " + DIRECT; break;
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE: message = "이 휴대폰과 맞지 않아 설치하지 못했습니다."; break;
            case PackageInstaller.STATUS_FAILURE_INVALID: message = "APK를 확인하지 못해 설치하지 못했습니다. 다시 받아 주세요."; break;
            case PackageInstaller.STATUS_FAILURE_STORAGE: message = "저장 공간이 부족해 설치하지 못했습니다. 공간을 비운 뒤 다시 시도하세요."; break;
            case 8: message = "설치 시간이 초과됐습니다. 다시 시도하세요."; break; // STATUS_FAILURE_TIMEOUT(API 34)
            default: message = "설치하지 못했습니다. 다시 시도하거나 " + DIRECT;
        }
        synchronized (Updates.class) {
            // APK 자체를 읽지 못했으면 받은 파일을 버리고 다시 받게 한다. 그 밖에는 받은 파일로 다시 설치할 수 있다.
            if (result == PackageInstaller.STATUS_FAILURE_INVALID && apkFile != null) { clear(apkFile.getParentFile()); apkFile = null; received = 0; set("available", "UPDATE_INSTALL_FAILED", message); }
            else set("ready", "UPDATE_INSTALL_FAILED", message);
        }
    }
}
