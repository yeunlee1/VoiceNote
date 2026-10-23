// 설정 파일 2판을 JVM에서 직접 검증하고 Windows와 같은 파일 판정을 비교한다.
package kr.local.meetingjournal;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
public final class SettingsFileTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    static byte[] bytes(String value){return value.getBytes(StandardCharsets.UTF_8);}
    static String base(){return "{\"format\":\"voicenote-settings\",\"version\":2,\"summaryModel\":\"gpt-6.1-sol\",\"defaultOutputFormat\":\"meeting\",\"customFormat\":null}";}
    static void rejects(byte[] value,String message)throws Exception{
        try{SettingsFile.read(value);throw new AssertionError("거절해야 합니다: "+message);}catch(IOException ex){expect(ex.getMessage().equals(message),"거절 문구: "+ex.getMessage());}
    }
    public static void main(String[] args)throws Exception{
        if(args.length==3&&args[0].equals("--roundtrip")){Files.write(Paths.get(args[2]),SettingsFile.write(SettingsFile.read(Files.readAllBytes(Paths.get(args[1])))));return;}
        if(args.length>1&&args[0].equals("--verdict")){
            for(int i=1;i<args.length;i++){
                String result;try{SettingsFile.Value value=SettingsFile.read(Files.readAllBytes(Paths.get(args[i])));result="\"ok\":true,\"value\":"+new String(SettingsFile.write(value),StandardCharsets.UTF_8);}
                catch(IOException ex){result="\"ok\":false,\"message\":"+JsonText.quote(ex.getMessage());}
                System.out.println("{\"file\":"+JsonText.quote(Paths.get(args[i]).getFileName().toString())+","+result+"}");
            }return;
        }
        SettingsFile.Value value=SettingsFile.read(bytes(base()));
        expect(value.summaryModel.equals("gpt-6.1-sol")&&value.defaultOutputFormat.equals("meeting")&&value.customFormat==null,"기본 2판 값");
        byte[] exported=SettingsFile.write(value);
        expect(!new String(exported,StandardCharsets.UTF_8).contains("\"storage\""),"Android 내보내기에는 storage가 없다");
        expect(Arrays.equals(exported,SettingsFile.write(SettingsFile.read(exported))),"2판 왕복 바이트 일치");
        expect(SettingsFile.read(bytes("\uFEFF"+base())).summaryModel.equals(value.summaryModel),"BOM 허용");
        String withStorage=base().replace("\"customFormat\":null","\"customFormat\":null,\"storage\":{\"audio\":\"D:\\\\합성\",\"transcript\":\"\",\"summary\":\"\"}");
        expect(Arrays.equals(exported,SettingsFile.write(SettingsFile.read(bytes(withStorage)))),"유효한 Windows storage는 버리고 내보낸다");
        String custom="{\"name\":\" 주간 \",\"sections\":[{\"key\":\"overview\",\"title\":\" 요약 \"}],\"instruction\":\"  지시  \"}";
        SettingsFile.Value defined=SettingsFile.read(bytes(base().replace("\"customFormat\":null","\"customFormat\":"+custom)));
        expect(defined.customFormat.name.equals("주간")&&defined.customFormat.instruction.equals("지시"),"내 형식 정규화");
        rejects(bytes("{\"format\":\"voicenote-project-settings\",\"version\":1,\"projects\":[]}"),SettingsFile.LEGACY_MESSAGE);
        rejects(bytes(base().replace("\"version\":2","\"version\":3")),"이 VoiceNote보다 새 버전(3)의 설정 파일입니다. 프로그램을 업데이트한 뒤 불러오세요.");
        rejects(bytes(base().replace("\"version\":2","\"version\":1")),"설정 파일 버전을 확인할 수 없습니다.");
        rejects(bytes(base().replace("\"summaryModel\":\"gpt-6.1-sol\"","\"summaryModel\":\"\"")),"요약 모델 항목을 확인하세요.");
        rejects(bytes(base().replace(",\"customFormat\":null","")),"내 형식 항목이 없습니다.");
        rejects(bytes(base().replace("\"customFormat\":null","\"customFormat\":false")),"내 형식 내용을 확인하세요.");
        rejects(bytes(withStorage.replace("\"summary\":\"\"","\"summary\":null")),"저장 위치 항목을 확인하세요.");
        rejects(bytes(base()+","),"JSON 형식이 아닌 파일입니다. VoiceNote에서 내보낸 설정 파일인지 확인하세요.");
        rejects(new byte[]{(byte)0xC3,0x28},"UTF-8로 저장된 설정 파일이 아닙니다. VoiceNote에서 내보낸 파일인지 확인하세요.");
        byte[] large=new byte[SettingsFile.MAX_BYTES+1];Arrays.fill(large,(byte)' ');rejects(large,"설정 파일이 128KiB를 넘었습니다.");
        byte[] exact=Arrays.copyOf(bytes(base()),SettingsFile.MAX_BYTES);Arrays.fill(exact,bytes(base()).length,exact.length,(byte)' ');
        expect(SettingsFile.read(exact).customFormat==null,"정확히 128KiB 허용");
        expect(SettingsFile.read(bytes(base().replace("\"version\":2","\"version\":1,\"version\":2"))).summaryModel.equals(value.summaryModel),"중복 키는 Windows처럼 마지막 값");
        expect(SettingsFile.outputFormat(null).equals("meeting")&&SettingsFile.outputFormat("custom").equals("meeting")&&SettingsFile.outputFormat("tasks").equals("tasks"),"옛 결과에서 정의가 없는 내 형식은 회의록으로 대체한다");
        System.out.println("PASS "+checks+" settings v2 checks");
    }
}
