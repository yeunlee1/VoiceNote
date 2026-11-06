// 릴리즈 서명 도구가 만든 업데이트 목록을 휴대폰 앱의 확인 코드로 읽어 결과를 한 줄로 출력한다. 업데이트목록일치 시험이 부른다.
package kr.local.meetingjournal;
import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;

public final class UpdateManifestCheck {
    public static void main(String[] args)throws Exception{
        X509Certificate certificate;
        try(FileInputStream in=new FileInputStream(args[1])){certificate=(X509Certificate)CertificateFactory.getInstance("X.509").generateCertificate(in);}
        try{
            UpdateRules.Manifest manifest=UpdateRules.verifyManifest(Files.readAllBytes(Paths.get(args[0])),args[2],certificate.getPublicKey());
            System.out.println("ok "+manifest.apkName+" "+manifest.apkSize+" "+manifest.apkSha256+" "+manifest.versionCode);
        }catch(UpdateRules.Failure failure){System.out.println("fail "+failure.code);}
    }
}
