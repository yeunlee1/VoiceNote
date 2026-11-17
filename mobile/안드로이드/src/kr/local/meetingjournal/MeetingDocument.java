// 구조화된 회의 결과를 Windows 공통 예시와 같은 텍스트·Markdown으로 바꾼다. 목록 칸은 개조식(항목·하위 항목)으로 쓴다.
package kr.local.meetingjournal;
import org.json.*;
import java.util.*;

final class MeetingDocument {
    static String textFileName(String date,String title,String label){
        // 정리본 텍스트 파일 이름이다. Windows 앱의 baseName·saveResult와 같은 규칙으로 <날짜>-<제목>-<형식명>.txt를 만든다.
        String name=JsonText.trim(title==null?"":title).replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]","-");
        if(name.length()>70)name=name.substring(0,70);
        StringBuilder kind=new StringBuilder();
        for(char c:(label==null?"":label).toCharArray())if(!JsonText.space(c)&&"\\/:*?\"<>|".indexOf(c)<0)kind.append(c);
        // 공백은 JavaScript와 같은 집합(JsonText.space)으로 지운다. Java의 trim이나 \s와는 다루는 글자가 다르다.
        return (date==null||date.isEmpty()?"날짜없음":date)+"-"+(name.isEmpty()?"회의록":name)+"-"+kind+".txt";
    }

    static final class Head {
        final String title,date,participants,project,kind;final int sequence;final CustomFormat custom;
        Head(String title,String date,String participants,String project,int sequence,String kind,CustomFormat custom){
            this.title=title;this.date=date;this.participants=participants;this.project=project;this.sequence=sequence;this.kind=kind;this.custom=custom;
        }
    }
    static String string(Map<String,Object> map,String key){Object value=map.get(key);return value==null?"":String.valueOf(value);}
    static Head head(Map<String,Object> record){
        // 문서 머리의 제목·날짜·참석자·프로젝트·차수와 형식이다. 형식 판정은 Store.meetingFormat과 같다(내 형식이 올바르지 않으면 outputFormat 규칙으로 돌아감).
        Object sequence=record.get("dailySequence");String kind=SettingsFile.outputFormat(record.get("outputFormat"));CustomFormat custom=null;
        if("custom".equals(record.get("outputFormat"))&&record.get("customFormat") instanceof Map){try{custom=CustomFormat.validate(record.get("customFormat"));kind="custom";}catch(Exception ignored){}}
        return new Head(string(record,"title"),string(record,"date"),string(record,"participants"),string(record,"projectName"),sequence instanceof Number?((Number)sequence).intValue():0,kind,custom);
    }
    @SuppressWarnings("unchecked")
    static Map<String,Object> map(JSONObject value){return (Map<String,Object>)MinutesItems.plain(value);}
    static String markdown(JSONObject record,JSONObject minutes)throws Exception {return markdown(head(map(record)),map(minutes));}
    static String text(JSONObject record,JSONObject minutes)throws Exception {return text(head(map(record)),map(minutes));}

    static final class Topic {final String title;final List<MinutesItems.Item> points;Topic(String title,List<MinutesItems.Item> points){this.title=title;this.points=points;}}
    static List<Topic> topics(Map<String,Object> minutes){
        List<Topic> out=new ArrayList<>();
        for(Object topic:MinutesItems.list(minutes.get("topics"))){Object title=MinutesItems.field(topic,"title");out.add(new Topic(title==null?"":String.valueOf(title),MinutesItems.items(MinutesItems.field(topic,"points"))));}
        return out;
    }
    static List<MinutesItems.Item> section(Map<String,Object> minutes,String key){
        // 목록 칸 하나를 항목으로 바꾼다. 핵심 요약은 옛 머리말 줄을 머리말과 하위 항목으로 나눈다.
        return "overview".equals(key)?MinutesItems.overview(minutes.get(key)):MinutesItems.items(minutes.get(key));
    }
    static List<String> lines(Map<String,Object> minutes,String key){return MinutesItems.lines(section(minutes,key),"- ");}
    static String action(Object item){
        Object task=MinutesItems.field(item,"task"),owner=MinutesItems.field(item,"owner"),due=MinutesItems.field(item,"due");
        return "- "+task+" · 담당 "+(owner==null||String.valueOf(owner).isEmpty()?"미정":owner)+" · 기한 "+(due==null||String.valueOf(due).isEmpty()?"미정":due);
    }
    static void list(List<String> out,String title,List<String> lines){if(lines.isEmpty())return;out.add("## "+title);out.addAll(lines);out.add("");}
    static void markdownTopics(List<String> out,List<Topic> topics){for(Topic topic:topics){out.add("### "+topic.title);out.add("");out.addAll(MinutesItems.lines(topic.points,"- "));out.add("");}}
    static void topicSection(List<String> out,String title,List<Topic> topics){if(!topics.isEmpty()){out.add("## "+title);out.add("");markdownTopics(out,topics);}}
    static String markdown(Head head,Map<String,Object> minutes){
        List<String> out=new ArrayList<>();Collections.addAll(out,"# "+head.title,"");if(!head.project.isEmpty())out.add("프로젝트: "+head.project);
        Collections.addAll(out,"날짜: "+head.date+" · "+(head.sequence==0?1:head.sequence)+"차 회의","참석자: "+(head.participants.isEmpty()?"미입력":head.participants),"");
        List<Topic> topics=topics(minutes);List<Object> actions=MinutesItems.list(minutes.get("actions"));
        List<String> actionLines=new ArrayList<>();for(Object item:actions)actionLines.add(action(item));
        if("custom".equals(head.kind)){
            // 내 형식은 고른 항목만 고른 순서와 이름으로 쓰고, 내용이 없는 항목은 '없음'으로 남긴다.
            for(CustomFormat.Section section:head.custom.sections){
                out.add("## "+section.title);
                if(section.key.equals("topics")){out.add("");if(topics.isEmpty()){out.add("없음");out.add("");}else markdownTopics(out,topics);continue;}
                List<String> lines=section.key.equals("actions")?actionLines:lines(minutes,section.key);
                if(lines.isEmpty())out.add("- 없음");else out.addAll(lines);out.add("");
            }
        }else if("summary".equals(head.kind)){
            out.add("## 핵심 요약");out.addAll(lines(minutes,"overview"));out.add("");topicSection(out,"주요 내용",topics);
            list(out,"결정 사항",lines(minutes,"decisions"));list(out,"후속 작업",actionLines);list(out,"확인 필요",lines(minutes,"openQuestions"));
        }else if("tasks".equals(head.kind)){
            out.add("## 업무 요약");out.addAll(lines(minutes,"overview"));Collections.addAll(out,"","## 할 일");
            if(actionLines.isEmpty())out.add("- 확인된 할 일 없음");else out.addAll(actionLines);out.add("");
            list(out,"미확정 항목",lines(minutes,"openQuestions"));list(out,"결정 사항",lines(minutes,"decisions"));topicSection(out,"참고 내용",topics);
        }else{
            out.add("## 핵심 요약");out.addAll(lines(minutes,"overview"));Collections.addAll(out,"","## 다음 할 일");out.addAll(actionLines);
            Collections.addAll(out,"","## 상세 회의 내용","","## 합의된 방향");out.addAll(lines(minutes,"decisions"));out.add("");
            for(Topic topic:topics){out.add("## "+topic.title);out.add("");out.addAll(MinutesItems.lines(topic.points,"- "));out.add("");}
            out.add("## 미확정 사항");out.addAll(lines(minutes,"openQuestions"));out.add("");
        }return String.join("\n",out);
    }

    static String joined(List<String> lines){StringBuilder out=new StringBuilder();for(String line:lines)out.append(line).append("\n");return out.toString();}
    static String entries(List<String> lines){return lines.isEmpty()?"":joined(lines)+"\n";}
    // 텍스트 목록은 항목('- 본문')과 하위 항목('  - 하위')을 한 줄씩 쓰고, 목록 묶음 끝에 빈 줄 하나를 둔다. 빈 목록은 아무것도 쓰지 않는다.
    static String text(Head head,Map<String,Object> minutes){
        StringBuilder out=new StringBuilder(head.title).append("\n\n").append(head.date).append(" · ").append(head.sequence).append("차 회의");
        String overview=entries(lines(minutes,"overview"));if(overview.isEmpty())overview="\n";
        // 핵심 요약이 비어도 다음 제목과의 사이에 빈 줄 하나를 남긴다.
        if("custom".equals(head.kind)){
            out.append(" · ").append(head.custom.name);
            for(CustomFormat.Section section:head.custom.sections){
                out.append("\n\n").append(section.title).append("\n");
                if("topics".equals(section.key)){if(topics(minutes).isEmpty())out.append("없음\n");else topics(out,minutes);continue;}
                if("actions".equals(section.key)){if(MinutesItems.list(minutes.get("actions")).isEmpty())out.append("- 없음\n");else actions(out,minutes,true);continue;}
                String lines=joined(lines(minutes,section.key));out.append(lines.isEmpty()?"- 없음\n":lines);
            }
            return out.toString();
        }
        if("summary".equals(head.kind)){
            out.append(" · 핵심 요약\n\n핵심 요약\n").append(overview).append("주요 내용\n");topics(out,minutes);
            out.append("\n합의된 방향\n").append(entries(lines(minutes,"decisions"))).append("\n다음 할 일\n");actions(out,minutes,false);
            out.append("\n미확정 사항\n").append(entries(lines(minutes,"openQuestions")));return out.toString();
        }
        if("tasks".equals(head.kind)){
            // 업무 정리는 담당과 기한이 없으면 지어내지 않고 미정으로 보여 준다.
            out.append(" · 업무 정리\n\n업무 요약\n").append(overview).append("할 일\n");actions(out,minutes,true);
            out.append("\n확인 필요\n").append(entries(lines(minutes,"openQuestions"))).append("\n결정 사항\n").append(entries(lines(minutes,"decisions")));
            out.append("\n관련 논의\n");topics(out,minutes);return out.toString();
        }
        out.append("\n\n핵심 요약\n").append(overview).append("다음 할 일\n");actions(out,minutes,false);
        out.append("\n상세 회의 내용\n\n합의된 방향\n").append(entries(lines(minutes,"decisions")));topics(out,minutes);
        out.append("\n미확정 사항\n").append(entries(lines(minutes,"openQuestions")));return out.toString();
    }
    static void topics(StringBuilder out,Map<String,Object> minutes){for(Topic topic:topics(minutes))out.append("\n").append(topic.title).append("\n").append(entries(MinutesItems.lines(topic.points,"- ")));}
    static void actions(StringBuilder out,Map<String,Object> minutes,boolean undecided){
        for(Object a:MinutesItems.list(minutes.get("actions"))){
            Object task=MinutesItems.field(a,"task"),owner=MinutesItems.field(a,"owner"),due=MinutesItems.field(a,"due");out.append("- ").append(task);
            if(owner!=null&&!String.valueOf(owner).isEmpty())out.append(" · 담당 ").append(owner);else if(undecided)out.append(" · 담당 미정");
            if(due!=null&&!String.valueOf(due).isEmpty())out.append(" · 기한 ").append(due);else if(undecided)out.append(" · 기한 미정");
            out.append("\n");
        }
    }
}
