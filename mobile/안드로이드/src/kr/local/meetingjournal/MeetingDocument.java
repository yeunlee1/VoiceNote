// 구조화된 회의 결과를 Windows 공통 예시와 같은 텍스트·Markdown으로 바꾼다.
package kr.local.meetingjournal;
import org.json.*;
import java.util.*;

final class MeetingDocument {
    static String value(JSONObject object,String key){return object.isNull(key)?"":object.optString(key,"");}
    static String action(JSONObject item){String owner=value(item,"owner"),due=value(item,"due");return "- "+item.optString("task")+" · 담당 "+(owner.isEmpty()?"미정":owner)+" · 기한 "+(due.isEmpty()?"미정":due);}
    static void list(List<String> out,String title,JSONArray items,boolean actions)throws Exception {
        if(items.length()==0)return;out.add("## "+title);for(int i=0;i<items.length();i++)out.add(actions?action(items.getJSONObject(i)):"- "+items.getString(i));out.add("");
    }
    static void markdownTopics(List<String> out,JSONArray items)throws Exception {
        for(int i=0;i<items.length();i++){JSONObject topic=items.getJSONObject(i);out.add("### "+topic.getString("title"));out.add("");JSONArray points=topic.getJSONArray("points");for(int j=0;j<points.length();j++){out.add(points.getString(j));out.add("");}}
    }
    static void topicSection(List<String> out,String title,JSONArray topics)throws Exception {if(topics.length()>0){out.add("## "+title);out.add("");markdownTopics(out,topics);}}
    static String markdown(JSONObject record,JSONObject minutes)throws Exception {
        List<String> out=new ArrayList<>();Collections.addAll(out,"# "+record.optString("title"),"");String project=value(record,"projectName");if(!project.isEmpty())out.add("프로젝트: "+project);
        int sequence=record.optInt("dailySequence",1);if(sequence==0)sequence=1;String participants=value(record,"participants");
        Collections.addAll(out,"날짜: "+record.optString("date")+" · "+sequence+"차 회의","참석자: "+(participants.isEmpty()?"미입력":participants),"");
        String kind=Store.meetingFormat(record);JSONArray topics=minutes.getJSONArray("topics"),decisions=minutes.getJSONArray("decisions"),actions=minutes.getJSONArray("actions"),questions=minutes.getJSONArray("openQuestions");
        if("custom".equals(kind)){
            for(CustomFormat.Section section:Store.custom(record).sections){
                out.add("## "+section.title);
                if(section.key.equals("overview")){out.add(minutes.getString("overview"));out.add("");}
                else if(section.key.equals("topics")){out.add("");if(topics.length()==0){out.add("없음");out.add("");}else markdownTopics(out,topics);}
                else{JSONArray items=minutes.getJSONArray(section.key);if(items.length()==0)out.add("- 없음");for(int i=0;i<items.length();i++)out.add(section.key.equals("actions")?action(items.getJSONObject(i)):"- "+items.getString(i));out.add("");}
            }
        }else if("summary".equals(kind)){
            Collections.addAll(out,"## 핵심 요약",minutes.getString("overview"),"");topicSection(out,"주요 내용",topics);list(out,"결정 사항",decisions,false);list(out,"후속 작업",actions,true);list(out,"확인 필요",questions,false);
        }else if("tasks".equals(kind)){
            Collections.addAll(out,"## 업무 요약",minutes.getString("overview"),"","## 할 일");if(actions.length()==0)out.add("- 확인된 할 일 없음");for(int i=0;i<actions.length();i++)out.add(action(actions.getJSONObject(i)));out.add("");
            list(out,"미확정 항목",questions,false);list(out,"결정 사항",decisions,false);topicSection(out,"참고 내용",topics);
        }else{
            Collections.addAll(out,"## 핵심 요약",minutes.getString("overview"),"","## 상세 회의 내용","","## 합의된 방향");
            for(int i=0;i<decisions.length();i++){out.add(decisions.getString(i));out.add("");}
            for(int i=0;i<topics.length();i++){JSONObject topic=topics.getJSONObject(i);out.add("## "+topic.getString("title"));out.add("");JSONArray points=topic.getJSONArray("points");for(int j=0;j<points.length();j++){out.add(points.getString(j));out.add("");}}
            out.add("## 다음 할 일");for(int i=0;i<actions.length();i++)out.add(action(actions.getJSONObject(i)));out.add("");out.add("## 미확정 사항");for(int i=0;i<questions.length();i++)out.add("- "+questions.getString(i));out.add("");
        }return String.join("\n",out);
    }
    static String text(JSONObject record,JSONObject minutes) throws Exception {
        String kind=Store.meetingFormat(record);
        StringBuilder out=new StringBuilder(record.optString("title")).append("\n\n").append(record.optString("date")).append(" · ").append(record.optInt("dailySequence")).append("차 회의");
        if("custom".equals(kind)){
            // 내 형식은 고른 항목만 고른 순서와 이름으로 쓰고, 내용이 없는 항목은 없음으로 남긴다.
            CustomFormat custom=Store.custom(record);out.append(" · ").append(custom.name);
            for(CustomFormat.Section section:custom.sections){
                out.append("\n\n").append(section.title).append("\n");
                if("overview".equals(section.key)){out.append(minutes.getString("overview")).append("\n");continue;}
                if("topics".equals(section.key)){if(minutes.getJSONArray("topics").length()==0)out.append("없음\n");else topics(out,minutes);continue;}
                if("actions".equals(section.key)){if(minutes.getJSONArray("actions").length()==0)out.append("- 없음\n");else actions(out,minutes,true);continue;}
                JSONArray items=minutes.getJSONArray(section.key);if(items.length()==0)out.append("- 없음\n");
                for(int i=0;i<items.length();i++)out.append("- ").append(items.getString(i)).append("\n");
            }
            return out.toString();
        }
        if("summary".equals(kind)){
            out.append(" · 핵심 요약\n\n핵심 요약\n").append(minutes.getString("overview")).append("\n\n주요 내용\n");topics(out,minutes);
            out.append("\n합의된 방향\n");append(out,minutes.getJSONArray("decisions"));out.append("\n다음 할 일\n");actions(out,minutes,false);
            out.append("\n미확정 사항\n");append(out,minutes.getJSONArray("openQuestions"));return out.toString();
        }
        if("tasks".equals(kind)){
            // 업무 정리는 담당과 기한이 없으면 지어내지 않고 미정으로 보여 준다.
            out.append(" · 업무 정리\n\n업무 요약\n").append(minutes.getString("overview")).append("\n\n할 일\n");actions(out,minutes,true);
            out.append("\n확인 필요\n");append(out,minutes.getJSONArray("openQuestions"));out.append("\n결정 사항\n");append(out,minutes.getJSONArray("decisions"));
            out.append("\n관련 논의\n");topics(out,minutes);return out.toString();
        }
        out.append("\n\n핵심 요약\n").append(minutes.getString("overview")).append("\n\n상세 회의 내용\n\n합의된 방향\n");
        append(out,minutes.getJSONArray("decisions"));topics(out,minutes);
        out.append("\n다음 할 일\n");actions(out,minutes,false);
        out.append("\n미확정 사항\n");append(out,minutes.getJSONArray("openQuestions"));return out.toString();
    }
    static void topics(StringBuilder out,JSONObject minutes) throws Exception {JSONArray topics=minutes.getJSONArray("topics");for(int i=0;i<topics.length();i++){JSONObject topic=topics.getJSONObject(i);out.append("\n").append(topic.getString("title")).append("\n");append(out,topic.getJSONArray("points"));}}
    static void actions(StringBuilder out,JSONObject minutes,boolean undecided) throws Exception {
        JSONArray actions=minutes.getJSONArray("actions");
        for(int i=0;i<actions.length();i++){JSONObject a=actions.getJSONObject(i);out.append("- ").append(a.getString("task"));
            if(!a.isNull("owner")&&!a.optString("owner").isEmpty())out.append(" · 담당 ").append(a.optString("owner"));else if(undecided)out.append(" · 담당 미정");
            if(!a.isNull("due")&&!a.optString("due").isEmpty())out.append(" · 기한 ").append(a.optString("due"));else if(undecided)out.append(" · 기한 미정");
            out.append("\n");}
    }
    static void append(StringBuilder out,JSONArray entries) throws Exception {for(int i=0;i<entries.length();i++)out.append(entries.getString(i)).append("\n\n");}
}
