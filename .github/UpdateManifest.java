// 릴리즈할 Windows 설치파일과 Android APK의 크기·SHA-256으로 업데이트 목록을 만들고 Android 개인 서명 키(SHA256withRSA)로 서명한다. 키 암호는 환경변수로만 받고 출력하지 않는다.
// 실행: MEETING_SIGN_PASS=<암호> java UpdateManifest.java --version 1.5.0 --version-code 7 --windows <exe> --android <apk> --keystore <p12> --out <json>
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class UpdateManifest {
    private static final long WINDOWS_LIMIT = 512L * 1024 * 1024, ANDROID_LIMIT = 256L * 1024 * 1024;

    public static void main(String[] args) {
        try {
            run(options(args));
        } catch (Failure failure) {
            System.err.println(failure.getMessage());
            System.exit(1);
        } catch (Exception error) {
            // 키 저장소 오류 문구에는 암호가 들어가지 않지만, 원인 종류만 남기고 세부 문구는 내지 않는다.
            System.err.println("업데이트 목록을 서명하지 못했습니다: " + error.getClass().getSimpleName());
            System.exit(1);
        }
    }

    private static void run(Map<String, String> option) throws Exception {
        String version = option.get("version");
        if (!version.matches("(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,3})")) throw new Failure("버전 형식을 확인하세요: " + version);
        int versionCode;
        try { versionCode = Integer.parseInt(option.get("version-code")); } catch (NumberFormatException error) { throw new Failure("versionCode를 숫자로 넘기세요."); }
        if (versionCode < 1 || versionCode > 2100000000) throw new Failure("versionCode 범위를 확인하세요.");
        Path out = Paths.get(option.get("out"));
        if (Files.exists(out)) throw new Failure("출력 파일이 이미 있습니다. 덮어쓰지 않습니다.");
        String password = System.getenv("MEETING_SIGN_PASS");
        if (password == null || password.isEmpty()) throw new Failure("서명 암호(MEETING_SIGN_PASS)가 없습니다.");

        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(Paths.get(option.get("keystore")))) {
            store.load(in, password.toCharArray());
        } catch (Exception error) {
            throw new Failure("서명 파일을 열지 못했습니다. 암호와 파일을 확인하세요.");
        }
        List<String> keys = new ArrayList<>();
        for (String alias : Collections.list(store.aliases())) if (store.isKeyEntry(alias)) keys.add(alias);
        // apksigner처럼 서명 키가 하나일 때만 그 키를 쓴다. 여러 개면 어느 키인지 추측하지 않는다.
        if (keys.size() != 1) throw new Failure("서명 파일에 서명 키가 정확히 하나여야 합니다. 지금 " + keys.size() + "개입니다.");
        PrivateKey key = (PrivateKey) store.getKey(keys.get(0), password.toCharArray());
        X509Certificate certificate = (X509Certificate) store.getCertificate(keys.get(0));
        if (key == null || certificate == null || !"RSA".equals(key.getAlgorithm())) throw new Failure("RSA 서명 키와 인증서를 찾지 못했습니다.");

        String payload = "{\"app\":\"VoiceNote\",\"format\":1,\"version\":\"" + version + "\""
            + ",\"windows\":" + entry("VoiceNote-" + version + "-Windows-Setup.exe", Paths.get(option.get("windows")), WINDOWS_LIMIT, -1)
            + ",\"android\":" + entry("VoiceNote-" + version + "-Android.apk", Paths.get(option.get("android")), ANDROID_LIMIT, versionCode) + "}";
        byte[] message = payload.getBytes(StandardCharsets.UTF_8);
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(key);
        signer.update(message);
        byte[] signature = signer.sign();
        // 같은 인증서의 공개 키로 다시 확인해, 앱이 받아들이지 못할 목록을 내보내지 않는다.
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(certificate.getPublicKey());
        verifier.update(message);
        if (!verifier.verify(signature)) throw new Failure("만든 서명을 다시 확인하지 못했습니다.");

        String json = "{\"format\":1,\"algorithm\":\"SHA256withRSA\",\"payload\":" + quote(payload) + ",\"signature\":\"" + Base64.getEncoder().encodeToString(signature) + "\"}";
        Path temporary = out.resolveSibling(out.getFileName() + ".tmp");
        try (OutputStream file = Files.newOutputStream(temporary, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            file.write(json.getBytes(StandardCharsets.UTF_8));
        }
        Files.move(temporary, out, StandardCopyOption.ATOMIC_MOVE);
        System.out.println("certificateSha256=" + hex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())));
    }

    private static String entry(String name, Path file, long limit, int versionCode) throws Exception {
        if (!Files.isRegularFile(file)) throw new Failure("릴리즈 파일이 없습니다: " + name);
        long size = Files.size(file);
        if (size < 1 || size > limit) throw new Failure("릴리즈 파일 크기를 확인하세요: " + name);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = Files.newInputStream(file)) {
            byte[] buffer = new byte[65536];
            for (int read; (read = in.read(buffer)) != -1; ) digest.update(buffer, 0, read);
        }
        return "{\"name\":\"" + name + "\",\"size\":" + size + ",\"sha256\":\"" + hex(digest.digest()) + "\"" + (versionCode > 0 ? ",\"versionCode\":" + versionCode : "") + "}";
    }

    private static Map<String, String> options(String[] args) throws Failure {
        Map<String, String> option = new HashMap<>();
        for (int index = 0; index + 1 < args.length; index += 2) {
            if (!args[index].startsWith("--")) throw new Failure("알 수 없는 인수입니다: " + args[index]);
            option.put(args[index].substring(2), args[index + 1]);
        }
        if (args.length % 2 != 0) throw new Failure("인수 개수를 확인하세요.");
        for (String name : new String[]{"version", "version-code", "windows", "android", "keystore", "out"})
            if (!option.containsKey(name)) throw new Failure("--" + name + " 인수가 필요합니다.");
        return option;
    }

    // 목록에는 영문·숫자·기호만 들어가므로 따옴표와 역슬래시만 바꾸면 JSON 문자열이 된다.
    private static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            if (c < 0x20 || c > 0x7e) throw new IllegalStateException("목록에 영문·숫자가 아닌 글자가 있습니다.");
            if (c == '"' || c == '\\') out.append('\\');
            out.append(c);
        }
        return out.append('"').toString();
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b & 0xff));
        return out.toString();
    }

    private static final class Failure extends Exception {
        Failure(String message) { super(message); }
    }
}
