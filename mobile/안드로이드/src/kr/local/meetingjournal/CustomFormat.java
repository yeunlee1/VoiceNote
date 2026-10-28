// 데스크톱 출력형식.js와 같은 규칙으로 내 형식을 검증하고 AI 지시문과 저장용 JSON을 만든다. 안드로이드 라이브러리 없이 PC에서도 시험한다.
package kr.local.meetingjournal;

import java.io.IOException;
import java.util.*;

final class CustomFormat {
    static final List<String> KEYS=Collections.unmodifiableList(Arrays.asList("overview","topics","decisions","actions","openQuestions"));
    static final int NAME_MAX=30,TITLE_MAX=30,INSTRUCTION_MAX=1000;
    static final class Section {final String key,title;Section(String key,String title){this.key=key;this.title=title;}}
    final String name,instruction;final List<Section> sections;
    private CustomFormat(String name,List<Section> sections,String instruction){this.name=name;this.sections=Collections.unmodifiableList(sections);this.instruction=instruction;}

    static CustomFormat parse(String json) throws IOException {
        Object value;
        try{value=new JsonText.Parser(json).document();}catch(IOException ex){throw new IOException("내 형식 내용을 확인하세요.");}
        return validate(value);
    }

    static CustomFormat validate(Object value) throws IOException {
        // 검사 순서와 안내 문구는 데스크톱 validateCustom과 같다.
        if(!(value instanceof Map))throw new IOException("내 형식 내용을 확인하세요.");
        Map<?,?> map=(Map<?,?>)value;
        for(String key:JsonText.keys(map))if(!"name".equals(key)&&!"sections".equals(key)&&!"instruction".equals(key)){String text=String.valueOf(key);throw new IOException("내 형식에 알 수 없는 항목("+(text.length()>40?text.substring(0,40):text)+")이 있습니다.");}
        Object name=map.get("name");
        if(!(name instanceof String)||JsonText.trim((String)name).isEmpty()||JsonText.trim((String)name).length()>NAME_MAX)throw new IOException("내 형식 이름은 1~"+NAME_MAX+"자로 입력하세요.");
        Object list=map.get("sections");
        if(!(list instanceof List)||((List<?>)list).isEmpty()||((List<?>)list).size()>KEYS.size())throw new IOException("내 형식에 넣을 항목을 하나 이상 고르세요.");
        Set<String> seen=new HashSet<>();List<Section> sections=new ArrayList<>();
        for(Object item:(List<?>)list){
            if(!(item instanceof Map))throw new IOException("내 형식 항목을 확인하세요.");
            Map<?,?> section=(Map<?,?>)item;Object key=section.get("key");
            boolean extra=false;for(Object field:section.keySet())if(!"key".equals(field)&&!"title".equals(field))extra=true;
            if(!(key instanceof String)||!KEYS.contains(key)||extra)throw new IOException("내 형식 항목을 확인하세요.");
            if(!seen.add((String)key))throw new IOException("같은 항목을 두 번 넣을 수 없습니다.");
            Object title=section.get("title");
            if(!(title instanceof String)||JsonText.trim((String)title).isEmpty()||JsonText.trim((String)title).length()>TITLE_MAX)throw new IOException("항목 이름은 1~"+TITLE_MAX+"자로 입력하세요.");
            sections.add(new Section((String)key,JsonText.trim((String)title)));
        }
        Object instruction=map.get("instruction");if(instruction==null)instruction="";
        if(!(instruction instanceof String)||((String)instruction).length()>INSTRUCTION_MAX)throw new IOException("추가 지시는 1,000자 이하로 입력하세요.");
        return new CustomFormat(JsonText.trim((String)name),sections,JsonText.trim((String)instruction));
    }

    String instruction(){
        // 데스크톱 customInstruction과 글자 하나까지 같아야 한다. 바꿀 때는 두 곳을 함께 바꾼다.
        StringBuilder order=new StringBuilder();
        for(int i=0;i<sections.size();i++){if(i>0)order.append(" → ");order.append(sections.get(i).title).append('(').append(sections.get(i).key).append(')');}
        StringBuilder text=new StringBuilder("사용자가 정한 출력 형식 '").append(name).append("'으로 정리합니다. 결과에 보여 줄 항목과 순서는 ").append(order).append("입니다.\n")
            .append("목록에 없는 항목은 빈 배열로 두고, overview가 목록에 없으면 한 문장으로만 씁니다. 항목 이름은 프로그램이 붙이므로 본문에 다시 쓰지 않습니다.");
        if(!instruction.isEmpty())text.append("\n사용자 추가 지시: ").append(instruction).append("\n추가 지시가 위의 사실 확인·근거 규칙과 충돌하면 위 규칙을 따릅니다.");
        return text.toString();
    }

    String json(){
        StringBuilder out=new StringBuilder("{\"name\":").append(JsonText.quote(name)).append(",\"sections\":[");
        for(int i=0;i<sections.size();i++){if(i>0)out.append(',');out.append("{\"key\":").append(JsonText.quote(sections.get(i).key)).append(",\"title\":").append(JsonText.quote(sections.get(i).title)).append('}');}
        return out.append("],\"instruction\":").append(JsonText.quote(instruction)).append('}').toString();
    }
}
