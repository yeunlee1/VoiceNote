// 공통 문서 예시(회의문서-예시.json)의 모든 경우에서 휴대폰 MeetingDocument가 Windows 회의문서.cjs와 같은 Markdown·텍스트를 만드는지 PC(JVM)에서 검증한다.
package kr.local.meetingjournal;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
public final class MeetingDocumentTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    @SuppressWarnings("unchecked")
    public static void main(String[] args)throws Exception{
        Map<String,Object> root=(Map<String,Object>)new JsonText.Parser(new String(Files.readAllBytes(Paths.get(args[0])),StandardCharsets.UTF_8)).document();
        for(Object entry:(List<Object>)root.get("cases")){
            Map<String,Object> c=(Map<String,Object>)entry,record=(Map<String,Object>)c.get("record"),minutes=(Map<String,Object>)record.get("minutes");
            MeetingDocument.Head head=MeetingDocument.head(record);
            String markdown=MeetingDocument.markdown(head,minutes),text=MeetingDocument.text(head,minutes);
            expect(markdown.equals(c.get("markdown")),"공통 Markdown 예시 일치: "+c.get("name")+"\n"+markdown);
            expect(text.equals(c.get("text")),"공통 텍스트 예시 일치: "+c.get("name")+"\n"+text);
        }
        System.out.println("회의 문서 "+checks+"개 검증 통과");
    }
}
