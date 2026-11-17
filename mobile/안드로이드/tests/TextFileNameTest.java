// 정리본을 저장할 텍스트 파일의 이름이 Windows 앱과 같은 규칙으로 만들어지는지 JVM에서 확인한다.
package kr.local.meetingjournal;

public final class TextFileNameTest {
    private static int checks;
    private static void same(String actual,String expected){
        if(!expected.equals(actual))throw new AssertionError("파일 이름이 다릅니다. 기대: "+expected+" / 실제: "+actual);
        checks++;
    }
    private static String repeat(char c,int count){return new String(new char[count]).replace('\0',c);}
    public static void main(String[] args){
        same(MeetingDocument.textFileName("2026-11-09","주간 업무 회의","회의록"),"2026-11-09-주간 업무 회의-회의록.txt");
        // 파일 이름에 쓸 수 없는 글자와 제어문자는 '-'로 바꾸고, 형식 이름의 공백은 지운다(Windows baseName·saveResult와 같다).
        same(MeetingDocument.textFileName("2026-11-09"," 가/나\\다:라*마?바\"사<아>자|차\u0001 ","핵심 요약"),"2026-11-09-가-나-다-라-마-바-사-아-자-차--핵심요약.txt");
        same(MeetingDocument.textFileName("2026-11-09",repeat('가',80),"회의록"),"2026-11-09-"+repeat('가',70)+"-회의록.txt");
        same(MeetingDocument.textFileName(""," ","주간 보고/1"),"날짜없음-회의록-주간보고1.txt");
        // 전각 공백과 NBSP도 JavaScript와 같이 공백으로 다룬다.
        same(MeetingDocument.textFileName("2026-11-09","　주간 회의 ","주간 보고　"),"2026-11-09-주간 회의-주간보고.txt");
        same(MeetingDocument.textFileName(null,null,"회의록"),"날짜없음-회의록-회의록.txt");
        System.out.println("PASS "+checks+" text file name checks");
    }
}
