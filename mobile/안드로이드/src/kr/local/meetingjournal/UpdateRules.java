// 휴대폰 앱 업데이트의 버전 비교, 깃허브 릴리즈 정보 읽기, 서명한 업데이트 목록 확인을 맡는다. Android API를 쓰지 않아 JVM에서 시험하고 데스크톱 업데이트검증.cjs와 같은 기준을 쓴다.
package kr.local.meetingjournal;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.util.*;

final class UpdateRules {
    static final String REPOSITORY="yeunlee1/VoiceNote";
    static final String RELEASE_API="https://api.github.com/repos/"+REPOSITORY+"/releases/latest";
    static final String RELEASE_PAGE="https://github.com/"+REPOSITORY+"/releases/latest";
    static final String DOWNLOAD_ROOT="https://github.com/"+REPOSITORY+"/releases/download/";
    static final int RELEASE_LIMIT=2*1024*1024,MANIFEST_LIMIT=64*1024;
    static final long WINDOWS_LIMIT=512L*1024*1024,APK_LIMIT=256L*1024*1024;
    static final String DIRECT="깃허브 릴리즈 페이지에서 설치파일을 직접 받아 설치하세요.";

    // 화면에 그대로 보여 줄 문장과 상태 구분용 코드를 함께 담는다.
    static final class Failure extends IOException {
        final String code;
        Failure(String code,String message){super(message);this.code=code;}
    }
    static final class Asset {
        final String name,url,digest;final long size;
        Asset(String name,String url,long size,String digest){this.name=name;this.url=url;this.size=size;this.digest=digest;}
    }
    static final class Release {
        final String status,version,publishedAt,reason;final Asset manifest,apk;
        Release(String status,String version,String publishedAt,String reason,Asset manifest,Asset apk){this.status=status;this.version=version;this.publishedAt=publishedAt;this.reason=reason;this.manifest=manifest;this.apk=apk;}
    }
    static final class Manifest {
        final String version,apkName,apkSha256;final long apkSize,versionCode;
        Manifest(String version,String apkName,long apkSize,String apkSha256,long versionCode){this.version=version;this.apkName=apkName;this.apkSize=apkSize;this.apkSha256=apkSha256;this.versionCode=versionCode;}
    }

    // 1.4.0처럼 숫자 세 마디만 받는다. 앞자리 0, 접미사, 네 마디는 같은 버전을 다르게 쓸 수 있어 받지 않는다.
    static int[] parseVersion(String value){
        if(value==null||!value.matches("(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,3})"))return null;
        String[] parts=value.split("\\.");
        return new int[]{Integer.parseInt(parts[0]),Integer.parseInt(parts[1]),Integer.parseInt(parts[2])};
    }
    static int compare(String left,String right){
        int[] a=parseVersion(left),b=parseVersion(right);
        if(a==null||b==null)throw new IllegalArgumentException("버전 형식을 확인하지 못했습니다.");
        for(int i=0;i<3;i++)if(a[i]!=b[i])return a[i]>b[i]?1:-1;
        return 0;
    }
    static String apkName(String version){return "VoiceNote-"+version+"-Android.apk";}
    static String windowsName(String version){return "VoiceNote-"+version+"-Windows-Setup.exe";}
    static String manifestName(String version){return "VoiceNote-"+version+"-update.json";}
    static String assetUrl(String version,String name){return DOWNLOAD_ROOT+"v"+version+"/"+name;}

    private static Failure invalidRelease(){return new Failure("UPDATE_RELEASE_INVALID","깃허브 릴리즈 정보를 읽지 못했습니다.");}
    private static Failure invalidManifest(){return new Failure("UPDATE_MANIFEST_INVALID","업데이트 정보의 형식이 맞지 않습니다. "+DIRECT);}
    private static Failure badSignature(){return new Failure("UPDATE_SIGNATURE_INVALID","업데이트 정보의 서명을 확인하지 못했습니다. "+DIRECT);}

    private static Object parse(String text)throws IOException{return new JsonText.Parser(text).document();}
    private static Map<?,?> object(Object value){return value instanceof Map?(Map<?,?>)value:null;}
    private static boolean exactKeys(Map<?,?> value,String... keys){
        if(value==null||value.size()!=keys.length)return false;
        for(String key:keys)if(!value.containsKey(key))return false;
        return true;
    }
    private static boolean whole(Object value,double min,double max){
        if(!(value instanceof Double))return false;double number=(Double)value;
        return number==Math.floor(number)&&number>=min&&number<=max;
    }

    // 깃허브 최신 릴리즈 응답에서 이번 버전 파일만 이름·주소·크기로 고른다. 하나라도 맞지 않으면 자동 설치하지 않고 직접 받기로 안내한다.
    static Release readRelease(String text,String currentVersion)throws Failure{
        Map<?,?> release;
        try{release=object(parse(text));}catch(IOException ex){throw invalidRelease();}
        if(release==null||!(release.get("assets") instanceof List))throw invalidRelease();
        Object tag=release.get("tag_name");
        String version=tag instanceof String&&((String)tag).startsWith("v")?((String)tag).substring(1):"";
        if(parseVersion(version)==null)throw invalidRelease();
        if(!Boolean.FALSE.equals(release.get("draft"))||!Boolean.FALSE.equals(release.get("prerelease"))||compare(version,currentVersion)<=0)
            return new Release("latest",version,null,null,null,null);
        String publishedAt=release.get("published_at") instanceof String?(String)release.get("published_at"):null;
        List<?> assets=(List<?>)release.get("assets");
        Asset manifest=pick(assets,version,manifestName(version),MANIFEST_LIMIT),apk=pick(assets,version,apkName(version),APK_LIMIT);
        if(manifest==null||apk==null)return new Release("manual",version,publishedAt,"새 버전의 자동 설치 정보를 찾지 못했습니다. "+DIRECT,null,null);
        return new Release("available",version,publishedAt,null,manifest,apk);
    }
    private static Asset pick(List<?> assets,String version,String name,long limit){
        for(Object item:assets){
            Map<?,?> asset=object(item);
            if(asset==null||!name.equals(asset.get("name")))continue;
            if(!"uploaded".equals(asset.get("state"))||!assetUrl(version,name).equals(asset.get("browser_download_url"))||!whole(asset.get("size"),1,limit))return null;
            Object digest=asset.get("digest");
            return new Asset(name,assetUrl(version,name),(long)(double)(Double)asset.get("size"),digest instanceof String&&((String)digest).matches("sha256:[0-9a-f]{64}")?(String)digest:null);
        }
        return null;
    }

    private static boolean file(Map<?,?> entry,String name,long limit,boolean apk){
        if(!(apk?exactKeys(entry,"name","size","sha256","versionCode"):exactKeys(entry,"name","size","sha256")))return false;
        if(!name.equals(entry.get("name"))||!whole(entry.get("size"),1,limit))return false;
        Object sha=entry.get("sha256");
        if(!(sha instanceof String)||!((String)sha).matches("[0-9a-f]{64}"))return false;
        return !apk||whole(entry.get("versionCode"),1,2100000000);
    }

    // 서명은 payload 글자 그대로(UTF-8)에 대해 확인하고, 확인한 뒤에만 그 글을 해석한다. 열쇠는 이 앱 자신의 서명 인증서다.
    static Manifest verifyManifest(byte[] bytes,String version,PublicKey key)throws Failure{
        if(bytes==null||bytes.length>MANIFEST_LIMIT||parseVersion(version)==null)throw invalidManifest();
        Map<?,?> outer;
        try{outer=object(parse(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()));}
        catch(CharacterCodingException ex){throw invalidManifest();}
        catch(IOException ex){throw invalidManifest();}
        if(!exactKeys(outer,"format","algorithm","payload","signature")||!whole(outer.get("format"),1,1)||!"SHA256withRSA".equals(outer.get("algorithm"))||!(outer.get("payload") instanceof String))throw invalidManifest();
        Object value=outer.get("signature");
        // 정해진 글자만 쓴 정규 base64인지 먼저 보고, 해석한 뒤 다시 만든 글자와도 맞춰 본다.
        if(!(value instanceof String))throw badSignature();
        String signature=(String)value;
        if(signature.length()<4||signature.length()>2048||signature.length()%4!=0||!signature.matches("[A-Za-z0-9+/]+={0,2}"))throw badSignature();
        byte[] raw;
        try{raw=Base64.getDecoder().decode(signature);}catch(IllegalArgumentException ex){throw badSignature();}
        if(!Base64.getEncoder().encodeToString(raw).equals(signature))throw badSignature();
        String text=(String)outer.get("payload");
        boolean valid;
        try{Signature verifier=Signature.getInstance("SHA256withRSA");verifier.initVerify(key);verifier.update(text.getBytes(StandardCharsets.UTF_8));valid=verifier.verify(raw);}
        catch(GeneralSecurityException|RuntimeException ex){valid=false;}
        if(!valid)throw badSignature();
        Map<?,?> payload;
        try{payload=object(parse(text));}catch(IOException ex){throw invalidManifest();}
        if(!exactKeys(payload,"app","format","version","windows","android")||!"VoiceNote".equals(payload.get("app"))||!whole(payload.get("format"),1,1)||!version.equals(payload.get("version")))throw invalidManifest();
        Map<?,?> windows=object(payload.get("windows")),android=object(payload.get("android"));
        if(!file(windows,windowsName(version),WINDOWS_LIMIT,false)||!file(android,apkName(version),APK_LIMIT,true))throw invalidManifest();
        return new Manifest(version,apkName(version),(long)(double)(Double)android.get("size"),(String)android.get("sha256"),(long)(double)(Double)android.get("versionCode"));
    }

    // 서명한 목록과 깃허브가 알려 준 APK 정보가 같은 파일을 가리키는지 본다. 깃허브 해시가 없으면 서명한 해시만 쓴다.
    static void matchAsset(Manifest manifest,Asset apk)throws Failure{
        if(apk==null||apk.size!=manifest.apkSize||(apk.digest!=null&&!apk.digest.equals("sha256:"+manifest.apkSha256)))
            throw new Failure("UPDATE_MANIFEST_INVALID","업데이트 정보와 깃허브 파일 정보가 서로 다릅니다. "+DIRECT);
    }

    static String sha256(File file)throws IOException{
        try(InputStream in=new FileInputStream(file)){
            MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];
            for(int read;(read=in.read(buffer))!=-1;)digest.update(buffer,0,read);
            StringBuilder out=new StringBuilder();for(byte b:digest.digest())out.append(String.format(Locale.ROOT,"%02x",b&0xff));
            return out.toString();
        }catch(GeneralSecurityException ex){throw new IOException("파일 해시를 계산하지 못했습니다.");}
    }
}
