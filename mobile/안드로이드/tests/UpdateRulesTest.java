// 휴대폰 앱 업데이트의 버전 비교, 깃허브 릴리즈 정보 읽기, 서명한 업데이트 목록 확인이 데스크톱과 같은 기준으로 위조·변조·형식 오류를 막는지 검증한다.
package kr.local.meetingjournal;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.*;
import java.util.*;

public final class UpdateRulesTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    static void fails(String code,Runnable work,String label){
        try{work.run();}catch(Wrapped wrapped){expect(code.equals(wrapped.failure.code)&&wrapped.failure.getMessage()!=null&&!wrapped.failure.getMessage().isEmpty(),label+" → "+wrapped.failure.code);return;}
        throw new AssertionError(label+": 거절되지 않음");
    }
    static final class Wrapped extends RuntimeException{final UpdateRules.Failure failure;Wrapped(UpdateRules.Failure failure){this.failure=failure;}}
    interface Work{void run()throws Exception;}
    static Runnable wrap(Work work){return ()->{try{work.run();}catch(UpdateRules.Failure failure){throw new Wrapped(failure);}catch(Exception other){throw new IllegalStateException("예상하지 못한 예외",other);}};}

    static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format("%02x",b&0xff));return out.toString();}
    static String sha(String text)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
    static String payload(String version,String change)throws Exception{
        String windows="{\"name\":\"VoiceNote-"+version+"-Windows-Setup.exe\",\"size\":11,\"sha256\":\""+sha("windows-app")+"\"}";
        String android="{\"name\":\"VoiceNote-"+version+"-Android.apk\",\"size\":7,\"sha256\":\""+sha("android")+"\",\"versionCode\":8}";
        String text="{\"app\":\"VoiceNote\",\"format\":1,\"version\":\""+version+"\",\"windows\":"+windows+",\"android\":"+android+"}";
        return change==null?text:change;
    }
    static byte[] manifest(String payload,PrivateKey key,String signature,String algorithm)throws Exception{
        String signed=signature;
        if(signed==null){Signature signer=Signature.getInstance("SHA256withRSA");signer.initSign(key);signer.update(payload.getBytes(StandardCharsets.UTF_8));signed=Base64.getEncoder().encodeToString(signer.sign());}
        return ("{\"format\":1,\"algorithm\":\""+algorithm+"\",\"payload\":"+JsonText.quote(payload)+",\"signature\":\""+signed+"\"}").getBytes(StandardCharsets.UTF_8);
    }
    static String release(String version,boolean draft,boolean prerelease,String apkUrl,boolean withManifest){
        String root="https://github.com/yeunlee1/VoiceNote/releases/download/v"+version+"/";
        String apk="{\"name\":\"VoiceNote-"+version+"-Android.apk\",\"size\":7,\"state\":\"uploaded\",\"digest\":\"sha256:"+safeSha("android")+"\",\"browser_download_url\":\""+(apkUrl==null?root+"VoiceNote-"+version+"-Android.apk":apkUrl)+"\"}";
        String manifest="{\"name\":\"VoiceNote-"+version+"-update.json\",\"size\":900,\"state\":\"uploaded\",\"digest\":null,\"browser_download_url\":\""+root+"VoiceNote-"+version+"-update.json\"}";
        return "{\"tag_name\":\"v"+version+"\",\"draft\":"+draft+",\"prerelease\":"+prerelease+",\"published_at\":\"2026-11-20T01:00:00Z\",\"assets\":["+apk+(withManifest?","+manifest:"")+"]}";
    }
    static String safeSha(String text){try{return sha(text);}catch(Exception ex){throw new IllegalStateException(ex);}}

    public static void main(String[] args)throws Exception{
        // 버전은 숫자 세 마디만 받고 값으로 비교한다.
        expect(UpdateRules.compare("1.5.0","1.4.0")==1&&UpdateRules.compare("1.10.0","1.9.9")==1&&UpdateRules.compare("1.4.0","1.4.0")==0&&UpdateRules.compare("1.4.0","2.0.0")==-1,"버전 비교");
        for(String bad:new String[]{"1.4","v1.4.0","1.04.0","1.4.0-beta"," 1.4.0","1.4.0.0","","99999.0.0"})expect(UpdateRules.parseVersion(bad)==null,"잘못된 버전 "+bad);
        expect(UpdateRules.parseVersion(null)==null,"null 버전");

        // 릴리즈 정보에서 정해진 이름·주소의 파일만 고른다.
        UpdateRules.Release found=UpdateRules.readRelease(release("1.5.1",false,false,null,true),"1.5.0");
        expect("available".equals(found.status)&&"1.5.1".equals(found.version)&&"2026-11-20T01:00:00Z".equals(found.publishedAt),"새 버전");
        expect(found.apk.url.equals("https://github.com/yeunlee1/VoiceNote/releases/download/v1.5.1/VoiceNote-1.5.1-Android.apk")&&found.apk.size==7&&found.apk.digest.equals("sha256:"+sha("android")),"APK 파일");
        expect(found.manifest.url.endsWith("/v1.5.1/VoiceNote-1.5.1-update.json")&&found.manifest.digest==null,"목록 파일");
        expect("latest".equals(UpdateRules.readRelease(release("1.5.0",false,false,null,true),"1.5.0").status),"같은 버전");
        expect("latest".equals(UpdateRules.readRelease(release("1.5.1",true,false,null,true),"1.5.0").status),"초안");
        expect("latest".equals(UpdateRules.readRelease(release("1.5.1",false,true,null,true),"1.5.0").status),"시험판");
        UpdateRules.Release manual=UpdateRules.readRelease(release("1.5.1",false,false,null,false),"1.5.0");
        expect("manual".equals(manual.status)&&manual.reason.contains("깃허브"),"목록 없음은 직접 받기");
        expect("manual".equals(UpdateRules.readRelease(release("1.5.1",false,false,"https://github.com/other/VoiceNote/releases/download/v1.5.1/VoiceNote-1.5.1-Android.apk",true),"1.5.0").status),"다른 저장소 주소");
        expect("manual".equals(UpdateRules.readRelease(release("1.5.1",false,false,"http://github.com/yeunlee1/VoiceNote/releases/download/v1.5.1/VoiceNote-1.5.1-Android.apk",true),"1.5.0").status),"HTTP 주소");
        for(String bad:new String[]{"","[]","{\"tag_name\":\"v1.5\",\"assets\":[]}","{\"tag_name\":\"latest\",\"assets\":[]}","{\"tag_name\":\"v1.5.1\",\"assets\":\"x\"}","{"})
            fails("UPDATE_RELEASE_INVALID",wrap(()->UpdateRules.readRelease(bad,"1.5.0")),"릴리즈 형식 "+bad);

        // 맞는 키로 서명한 목록만 통과하고 서명한 글 그대로 읽는다.
        KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(2048);
        KeyPair keys=generator.generateKeyPair(),other=generator.generateKeyPair();
        UpdateRules.Manifest ok=UpdateRules.verifyManifest(manifest(payload("1.5.1",null),keys.getPrivate(),null,"SHA256withRSA"),"1.5.1",keys.getPublic());
        expect(ok.apkSize==7&&ok.apkSha256.equals(sha("android"))&&ok.versionCode==8&&ok.apkName.equals("VoiceNote-1.5.1-Android.apk"),"목록 내용");
        fails("UPDATE_SIGNATURE_INVALID",wrap(()->UpdateRules.verifyManifest(manifest(payload("1.5.1",null),other.getPrivate(),null,"SHA256withRSA"),"1.5.1",keys.getPublic())),"다른 키");
        String text=payload("1.5.1",null);
        Signature signer=Signature.getInstance("SHA256withRSA");signer.initSign(keys.getPrivate());signer.update(text.getBytes(StandardCharsets.UTF_8));String signature=Base64.getEncoder().encodeToString(signer.sign());
        fails("UPDATE_SIGNATURE_INVALID",wrap(()->UpdateRules.verifyManifest(manifest(text.replace("\"size\":7","\"size\":8"),null,signature,"SHA256withRSA"),"1.5.1",keys.getPublic())),"서명 뒤 변조");
        fails("UPDATE_SIGNATURE_INVALID",wrap(()->UpdateRules.verifyManifest(manifest(text,null,signature+"!","SHA256withRSA"),"1.5.1",keys.getPublic())),"서명 글자 오류");
        fails("UPDATE_SIGNATURE_INVALID",wrap(()->UpdateRules.verifyManifest(manifest(text,null,"","SHA256withRSA"),"1.5.1",keys.getPublic())),"빈 서명");
        fails("UPDATE_MANIFEST_INVALID",wrap(()->UpdateRules.verifyManifest(manifest(text,null,signature,"SHA1withRSA"),"1.5.1",keys.getPublic())),"다른 알고리즘");
        fails("UPDATE_MANIFEST_INVALID",wrap(()->UpdateRules.verifyManifest("{\"format\":1".getBytes(StandardCharsets.UTF_8),"1.5.1",keys.getPublic())),"깨진 목록");
        fails("UPDATE_MANIFEST_INVALID",wrap(()->UpdateRules.verifyManifest(new byte[64*1024+1],"1.5.1",keys.getPublic())),"너무 큰 목록");
        fails("UPDATE_MANIFEST_INVALID",wrap(()->UpdateRules.verifyManifest(new byte[]{(byte)0xff,(byte)0xfe},"1.5.1",keys.getPublic())),"UTF-8 아님");

        // 서명이 맞아도 버전·파일 이름·형식이 다르면 거절한다.
        fails("UPDATE_MANIFEST_INVALID",wrap(()->UpdateRules.verifyManifest(manifest(payload("1.5.1",null),keys.getPrivate(),null,"SHA256withRSA"),"1.5.2",keys.getPublic())),"다른 버전");
        String[] changes={text.replace("\"VoiceNote\",","\"Other\","),text.replace("\"format\":1,","\"format\":2,"),text.replace("VoiceNote-1.5.1-Android.apk","VoiceNote-1.5.0-Android.apk"),
            text.replace("\"versionCode\":8","\"versionCode\":8.5"),text.replace("\"versionCode\":8","\"versionCode\":\"8\""),text.replace("\"versionCode\":8","\"versionCode\":0"),
            text.replace("\"size\":7","\"size\":0"),text.replace(sha("android"),sha("android").toUpperCase()),text.replace("}}",",\"extra\":true}}"),text.replace("{\"app\"","{\"extra\":1,\"app\""),"[1]"};
        for(String change:changes)fails("UPDATE_MANIFEST_INVALID",wrap(()->UpdateRules.verifyManifest(manifest(change,keys.getPrivate(),null,"SHA256withRSA"),"1.5.1",keys.getPublic())),"내용 "+change.substring(0,Math.min(40,change.length())));

        // 목록의 APK 크기·해시가 깃허브 파일 정보와 어긋나면 받지 않는다.
        UpdateRules.matchAsset(ok,found.apk);checks++;
        fails("UPDATE_MANIFEST_INVALID",wrap(()->UpdateRules.matchAsset(ok,new UpdateRules.Asset(found.apk.name,found.apk.url,8,found.apk.digest))),"크기 다름");
        fails("UPDATE_MANIFEST_INVALID",wrap(()->UpdateRules.matchAsset(ok,new UpdateRules.Asset(found.apk.name,found.apk.url,7,"sha256:"+sha("other")))),"해시 다름");
        UpdateRules.matchAsset(ok,new UpdateRules.Asset(found.apk.name,found.apk.url,7,null));checks++;

        // 파일 해시는 스트림으로 계산한다.
        File folder=Files.createTempDirectory("update-rules-").toFile();
        try{File file=new File(folder,"VoiceNote.apk");Files.write(file.toPath(),"android".getBytes(StandardCharsets.UTF_8));expect(UpdateRules.sha256(file).equals(sha("android")),"파일 해시");}
        finally{for(File file:folder.listFiles())file.delete();folder.delete();}

        expect(UpdateRules.RELEASE_API.equals("https://api.github.com/repos/yeunlee1/VoiceNote/releases/latest")&&UpdateRules.RELEASE_PAGE.equals("https://github.com/yeunlee1/VoiceNote/releases/latest"),"고정 주소");
        System.out.println("UpdateRulesTest 통과: "+checks+"개 확인");
    }
}
