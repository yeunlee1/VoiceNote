// 회의 결과 항목(본문 text와 하위 항목 details) 규칙이다. 데스크톱 출력형식.js의 item·items·overviewItems·normalizeMinutes·itemLines·minutesLengths와 서버 응답 틀 검사와 같은 결과를 낸다.
package kr.local.meetingjournal;
import org.json.*;
import java.io.IOException;
import java.util.*;

final class MinutesItems {
    static final List<String> LABELS=Collections.unmodifiableList(Arrays.asList("전체 방향","주요 결정","다음 할 일","남은 쟁점"));
    // 회의록형 핵심 요약의 머리말이다. 옛 결과의 '머리말 | 내용' 줄은 이 넷으로 시작할 때만 머리말과 하위 항목으로 나눈다.
    static final int TEXT_MAX=1000,DETAILS_MAX=8,OVERVIEW_MAX=12,TOPICS_MAX=30,POINTS_MAX=30,LIST_MAX=40,TITLE_MAX=500,SUGGESTED_TITLE_MAX=120,TASK_MAX=2000,PERSON_MAX=200;
    // AI 응답 검사의 한도다. 데스크톱 서버.cjs의 itemSchema·minutesSchema·actionSchema와 같은 값이다.
    static final String MALFORMED="AI 응답 형식을 확인할 수 없습니다. 다시 시도하면 비용이 발생할 수 있습니다.";

    static final class Item {
        final String text;final List<String> details;
        Item(String text,List<String> details){this.text=text;this.details=Collections.unmodifiableList(new ArrayList<>(details));}
    }

    static boolean bullet(char c){return c=='-'||c=='•'||c=='·'||c=='*';}
    static String clean(Object value){
        // 앞뒤 공백과 맨 앞의 글머리표 묶음(기호 뒤에 공백이나 글 끝)을 뗀다. 글이 아니면 빈 글이다. '-5도'처럼 기호 뒤에 글이 붙으면 그대로 둔다.
        if(!(value instanceof String))return "";
        String text=JsonText.trim((String)value);int at=0;
        while(at<text.length()&&bullet(text.charAt(at))){
            int next=at+1;
            if(next<text.length()&&!JsonText.space(text.charAt(next)))break;
            while(next<text.length()&&JsonText.space(text.charAt(next)))next++;
            at=next;
        }
        return JsonText.trim(text.substring(at));
    }
    static List<Object> list(Object value){
        // JSONArray와 List를 같은 목록으로 읽는다. 목록이 아니면 빈 목록이다.
        List<Object> out=new ArrayList<>();
        if(value instanceof List)out.addAll((List<?>)value);
        else if(value instanceof JSONArray){JSONArray array=(JSONArray)value;for(int i=0;i<array.length();i++)out.add(array.opt(i));}
        return out;
    }
    static Object field(Object object,String key){
        // Map과 JSONObject의 칸을 같은 방법으로 읽는다. JSON null은 null이다.
        Object value=object instanceof Map?((Map<?,?>)object).get(key):object instanceof JSONObject?((JSONObject)object).opt(key):null;
        return value==JSONObject.NULL?null:value;
    }
    static boolean object(Object value){return value instanceof Map||value instanceof JSONObject;}

    static Item item(Object value){
        // 문자열이나 항목 하나를 앞뒤 공백과 앞 글머리표를 뗀 항목으로 바꾼다. 빈 하위 항목은 버리고, 본문이 비면 첫 하위 항목을 올리며, 둘 다 비면 null이다.
        if(value instanceof String){String text=clean(value);return text.isEmpty()?null:new Item(text,Collections.<String>emptyList());}
        if(!object(value))return null;
        List<String> details=new ArrayList<>();
        for(Object detail:list(field(value,"details"))){String text=clean(detail);if(!text.isEmpty())details.add(text);}
        String text=clean(field(value,"text"));
        if(!text.isEmpty())return new Item(text,details);
        return details.isEmpty()?null:new Item(details.get(0),details.subList(1,details.size()));
    }
    static List<Item> items(Object value){
        // 없는 칸·문자열 하나·문자열 목록·항목 목록을 모두 항목 목록으로 바꾼다. 옛 문단은 길이와 관계없이 항목 하나가 된다.
        List<Item> out=new ArrayList<>();
        if(value instanceof String){Item one=item(value);if(one!=null)out.add(one);return out;}
        for(Object entry:list(value)){Item one=item(entry);if(one!=null)out.add(one);}
        return out;
    }
    static List<Item> overview(Object value){
        // 옛 핵심 요약 문자열은 줄마다 항목 하나로, 알려진 머리말 줄은 첫 구분자에서 나눠 머리말과 하위 항목으로 바꾼다. 새 구조는 items와 같다.
        if(!(value instanceof String))return items(value);
        List<Item> out=new ArrayList<>();
        for(String line:((String)value).split("\r?\n",-1)){
            String text=clean(line);Item label=labelLine(text);
            if(label!=null)out.add(label);
            else if(!text.isEmpty())out.add(new Item(text,Collections.<String>emptyList()));
        }
        return out;
    }
    static Item labelLine(String text){
        // 출력형식.js LABEL_LINE(^(머리말)\s*\|(.*)$)과 같은 판정이다. 머리말 뒤 공백은 JavaScript \s와 같은 집합(JsonText.space)으로 본다.
        for(String label:LABELS){
            if(!text.startsWith(label))continue;
            int at=label.length();while(at<text.length()&&JsonText.space(text.charAt(at)))at++;
            if(at>=text.length()||text.charAt(at)!='|')return null;
            String rest=text.substring(at+1);
            for(int i=0;i<rest.length();i++){char c=rest.charAt(i);if(c=='\n'||c=='\r'||c==' '||c==' ')return null;}
            String detail=clean(rest);
            return new Item(label,detail.isEmpty()?Collections.<String>emptyList():Collections.singletonList(detail));
        }
        return null;
    }

    static Map<String,Object> normalize(Map<String,Object> minutes){
        // 저장 원본은 바꾸지 않고, 핵심 요약·주제 항목·결정·미확정만 항목 목록으로 바꾼 새 Map을 돌려준다. 할 일과 제목은 그대로다. 출력형식.js normalizeMinutes와 같다.
        Map<String,Object> out=new LinkedHashMap<>(minutes);
        out.put("overview",plain(overview(minutes.get("overview"))));
        List<Object> topics=new ArrayList<>();
        for(Object topic:list(minutes.get("topics"))){
            Map<String,Object> copy=new LinkedHashMap<>();
            if(topic instanceof Map)for(Map.Entry<?,?> entry:((Map<?,?>)topic).entrySet())copy.put(String.valueOf(entry.getKey()),entry.getValue());
            copy.put("points",plain(items(field(topic,"points"))));
            topics.add(copy);
        }
        out.put("topics",topics);
        out.put("decisions",plain(items(minutes.get("decisions"))));
        out.put("openQuestions",plain(items(minutes.get("openQuestions"))));
        return out;
    }
    @SuppressWarnings("unchecked")
    static JSONObject normalize(JSONObject minutes)throws JSONException {return (JSONObject)json(normalize((Map<String,Object>)plain(minutes)));}
    static JSONObject prune(JSONObject minutes)throws JSONException {return normalize(minutes);}
    // 새 구조 AI 응답의 빈 값 정리는 item 규칙과 같으므로 같은 바꾸기를 쓴다.

    static List<String> lines(List<Item> items,String marker){
        // 항목은 기호와 본문 첫 줄로 쓰고, 이어지는 줄은 기호 폭만큼 들여 쓴다. 하위 항목은 두 칸 들여 '- '로 쓴다. 출력형식.js itemLines와 같다.
        StringBuilder indent=new StringBuilder();for(int i=0;i<marker.length();i++)indent.append(' ');
        List<String> out=new ArrayList<>();
        for(Item item:items){block(out,item.text,marker,indent.toString());for(String detail:item.details)block(out,detail,"  - ","    ");}
        return out;
    }
    static void block(List<String> out,String text,String first,String rest){
        // 이어지는 줄은 빈 줄을 그대로 두고, 첫머리 글머리표 묶음만 떼어 실제 하위 항목과 다른 모양으로 쓴다.
        String[] parts=text.split("\r?\n",-1);
        out.add(first+JsonText.trim(parts[0]));
        for(int i=1;i<parts.length;i++){String line=clean(parts[i]);out.add(line.isEmpty()?"":rest+line);}
    }

    static int length(Object value){
        // 옛 문자열은 원래 길이를, 항목은 본문과 하위 항목의 글자 수를 센다. 출력형식.js minutesLengths의 field와 같다.
        if(value instanceof String)return ((String)value).length();
        if(!(value instanceof List)&&!(value instanceof JSONArray))return 0;
        int size=0;
        for(Object entry:list(value)){
            if(entry==null||entry==JSONObject.NULL)continue;
            if(object(entry)){Object text=field(entry,"text");size+=text==null?0:String.valueOf(text).length();for(Object detail:list(field(entry,"details")))size+=detail==null||detail==JSONObject.NULL?0:String.valueOf(detail).length();}
            else size+=String.valueOf(entry).length();
        }
        return size;
    }
    static int bodyLength(Object minutes){
        // 줄일 수 있는 본문(핵심 요약·주제 제목·주제 항목)의 글자 수다.
        int size=length(field(minutes,"overview"));
        for(Object topic:list(field(minutes,"topics"))){Object title=field(topic,"title");size+=(title==null?"":String.valueOf(title)).length()+length(field(topic,"points"));}
        return size;
    }
    static int keptLength(Object minutes){
        // 그대로 둘 목록(결정·할 일·미확정)의 글자 수다. 담당·기한이 null이면 0자로 센다.
        int size=length(field(minutes,"decisions"))+length(field(minutes,"openQuestions"));
        for(Object action:list(field(minutes,"actions")))for(String name:new String[]{"task","owner","due"}){Object value=field(action,name);if(value!=null)size+=String.valueOf(value).length();}
        return size;
    }

    static void checkResponse(JSONObject minutes,boolean compact)throws IOException {checkResponse(plain(minutes),compact);}
    static void checkResponse(Object minutes,boolean compact)throws IOException {
        // 새 AI 응답이 항목 구조와 한도를 지키는지 확인한다. 옛 문자열 구조나 모르는 칸이면 형식 오류다. 데스크톱 서버의 minutesSchema(줄이기는 overview·topics만)와 같은 규칙이다.
        Map<?,?> map=require(minutes);
        List<String> allowed=compact?Arrays.asList("overview","topics"):Arrays.asList("suggestedTitle","overview","topics","decisions","actions","openQuestions");
        for(Object key:map.keySet())if(!allowed.contains(key))throw new IOException(MALFORMED);
        for(String key:allowed)if(!"suggestedTitle".equals(key)&&!map.containsKey(key))throw new IOException(MALFORMED);
        if(map.containsKey("suggestedTitle"))text(map.get("suggestedTitle"),1,SUGGESTED_TITLE_MAX);
        checkItems(map.get("overview"),OVERVIEW_MAX);
        List<?> topics=array(map.get("topics"),TOPICS_MAX);
        for(Object topic:topics){Map<?,?> entry=exact(topic,"title","points");text(entry.get("title"),0,TITLE_MAX);checkItems(entry.get("points"),POINTS_MAX);}
        if(compact)return;
        checkItems(map.get("decisions"),LIST_MAX);checkItems(map.get("openQuestions"),LIST_MAX);
        for(Object action:array(map.get("actions"),LIST_MAX)){Map<?,?> entry=exact(action,"task","owner","due");text(entry.get("task"),0,TASK_MAX);nullableText(entry.get("owner"));nullableText(entry.get("due"));}
    }
    static Map<?,?> require(Object value)throws IOException {if(!(value instanceof Map))throw new IOException(MALFORMED);return (Map<?,?>)value;}
    static Map<?,?> exact(Object value,String... keys)throws IOException {
        Map<?,?> map=require(value);List<String> names=Arrays.asList(keys);
        if(map.size()!=keys.length)throw new IOException(MALFORMED);
        for(Object key:map.keySet())if(!names.contains(key))throw new IOException(MALFORMED);
        return map;
    }
    static List<?> array(Object value,int max)throws IOException {if(!(value instanceof List)||((List<?>)value).size()>max)throw new IOException(MALFORMED);return (List<?>)value;}
    static void text(Object value,int min,int max)throws IOException {if(!(value instanceof String)||((String)value).length()<min||((String)value).length()>max)throw new IOException(MALFORMED);}
    static void nullableText(Object value)throws IOException {if(value!=null)text(value,0,PERSON_MAX);}
    static void checkItems(Object value,int max)throws IOException {
        for(Object item:array(value,max)){Map<?,?> entry=exact(item,"text","details");text(entry.get("text"),1,TEXT_MAX);for(Object detail:array(entry.get("details"),DETAILS_MAX))text(detail,1,TEXT_MAX);}
    }

    static Object plain(Object value){
        // org.json 값을 Map·List·null로 바꾼다. 항목은 text·details Map이다. PC 시험은 이 바꾼 값으로 같은 규칙을 돌린다.
        if(value==JSONObject.NULL)return null;
        if(value instanceof JSONObject){JSONObject object=(JSONObject)value;Map<String,Object> out=new LinkedHashMap<>();for(Iterator<String> keys=object.keys();keys.hasNext();){String key=keys.next();out.put(key,plain(object.opt(key)));}return out;}
        if(value instanceof JSONArray){List<Object> out=new ArrayList<>();for(Object entry:list(value))out.add(plain(entry));return out;}
        if(value instanceof Item){Item item=(Item)value;Map<String,Object> out=new LinkedHashMap<>();out.put("text",item.text);out.put("details",new ArrayList<Object>(item.details));return out;}
        if(value instanceof List){List<Object> out=new ArrayList<>();for(Object entry:(List<?>)value)out.add(plain(entry));return out;}
        return value;
    }
    static Object json(Object value)throws JSONException {
        // Map·List·null을 org.json 값으로 되돌린다. 칸 순서는 Map 순서를 따른다.
        if(value==null)return JSONObject.NULL;
        if(value instanceof Map){JSONObject out=new JSONObject();for(Map.Entry<?,?> entry:((Map<?,?>)value).entrySet())out.put(String.valueOf(entry.getKey()),json(entry.getValue()));return out;}
        if(value instanceof List){JSONArray out=new JSONArray();for(Object entry:(List<?>)value)out.put(json(entry));return out;}
        if(value instanceof Item)return json(plain(value));
        return value;
    }
}
