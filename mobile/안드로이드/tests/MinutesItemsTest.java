// 공통 항목 예시(회의결과-항목-예시.json)의 옛 결과 바꾸기·빈 값 정리·목록 줄을 휴대폰 MinutesItems가 데스크톱 출력형식.js와 같게 처리하는지 PC(JVM)에서 검증한다.
package kr.local.meetingjournal;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
public final class MinutesItemsTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    @SuppressWarnings("unchecked")
    public static void main(String[] args)throws Exception{
        Map<String,Object> cases=(Map<String,Object>)new JsonText.Parser(new String(Files.readAllBytes(Paths.get(args[0])),StandardCharsets.UTF_8)).document();
        for(Object entry:(List<Object>)cases.get("normalize")){
            Map<String,Object> c=(Map<String,Object>)entry;
            List<MinutesItems.Item> items="overview".equals(c.get("field"))?MinutesItems.overview(c.get("input")):MinutesItems.items(c.get("input"));
            expect(MinutesItems.plain(items).equals(c.get("expected")),"옛 결과 바꾸기: "+c.get("name")+" → "+MinutesItems.plain(items));
        }
        for(Object entry:(List<Object>)cases.get("prune")){
            Map<String,Object> c=(Map<String,Object>)entry;
            Map<String,Object> pruned=MinutesItems.normalize((Map<String,Object>)c.get("input"));
            expect(pruned.equals(c.get("expected")),"빈 값 정리: "+c.get("name")+" → "+pruned);
            expect(new ArrayList<>(pruned.keySet()).equals(new ArrayList<>(((Map<String,Object>)c.get("expected")).keySet())),"빈 값 정리의 칸 순서: "+c.get("name"));
        }
        for(Object entry:(List<Object>)cases.get("lines")){
            Map<String,Object> c=(Map<String,Object>)entry;
            List<String> lines=MinutesItems.lines(MinutesItems.items(c.get("items")),(String)c.get("marker"));
            expect(lines.equals(c.get("expected")),"목록 줄: "+c.get("name")+" → "+lines);
        }
        Map<String,Object> old=new LinkedHashMap<>();
        old.put("overview","전체 방향 | 먼저 진행\n- 이어지는 줄");old.put("topics",new ArrayList<>(Collections.singletonList(new LinkedHashMap<>(Map.of("title","주제","points",List.of("- 문단"))))));
        old.put("decisions",List.of("• 결정"));old.put("actions",new ArrayList<>());old.put("openQuestions","미정 하나");
        Map<String,Object> once=MinutesItems.normalize(old);
        expect(MinutesItems.normalize(once).equals(once),"이미 바꾼 결과를 다시 바꿔도 같다");
        expect(old.get("overview") instanceof String&&old.get("decisions").equals(List.of("• 결정")),"바꾸기는 원본을 고치지 않는다");
        expect(MinutesItems.bodyLength(once)==MinutesItems.length(once.get("overview"))+"주제".length()+"문단".length(),"본문 글자 수는 핵심 요약과 주제 제목·항목을 센다");
        expect(MinutesItems.length("가나다")==3&&MinutesItems.length(List.of(Map.of("text","가나","details",List.of("다","라마"))))==5,"옛 문자열은 그대로, 항목은 본문과 하위 항목을 센다");
        System.out.println("항목 규칙 "+checks+"개 검증 통과");
    }
}
