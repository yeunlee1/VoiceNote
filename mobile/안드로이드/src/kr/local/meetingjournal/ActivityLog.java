// 휴대폰 분석 작업 하나의 AI 요청 보냄·받음 일지를 메모리에 들고 화면 상태용 JSON으로 내준다. 줄 문구는 데스크톱 진행기록.js와 같다.
package kr.local.meetingjournal;
import java.util.*;

final class ActivityLog {
    interface Listener {void changed(boolean structural);}
    static final int MAX_ENTRIES=30;
    static final Set<String> FAILURE_TYPES=new HashSet<>(Arrays.asList("timeout","uploadStall","requestStall","disconnected","apiError","badFormat","saveFailed","failed","canceled"));

    static final class Entry {
        final int seq;final long at;final String type,text;
        Entry(int seq,long at,String type,String text){this.seq=seq;this.at=at;this.type=type;this.text=text;}
    }
    private static final class Open {String label,phase;long since,sent;Long size,waitSince;}

    private final String id=UUID.randomUUID().toString(),kind;private final Listener listener;
    private final ArrayDeque<Entry> entries=new ArrayDeque<>();
    private String location,meetingId,resultId;private int seq;private Open open;

    ActivityLog(String kind,Listener listener){this.kind=kind;this.listener=listener;}

    static Map<String,Object> fields(Object... pairs){
        // 줄에 붙일 값(조각·구간 번호, 크기, 상태 번호)을 이름·값 차례로 받아 묶는다.
        Map<String,Object> map=new LinkedHashMap<>();for(int i=0;i+1<pairs.length;i+=2)map.put(String.valueOf(pairs[i]),pairs[i+1]);return map;
    }

    void attach(String location,String meetingId,String resultId){
        synchronized(this){this.location=location;this.meetingId=meetingId;this.resultId=resultId;}
        changed(true);
    }
    void add(String type,Map<String,Object> fields){
        synchronized(this){append(type,fields);}
        changed(true);
    }
    void open(String sendType,Map<String,Object> fields,Long size){
        // 보냄 줄과 열린 요청을 함께 남긴다. 크기가 있으면 올리기부터, 없으면 처음부터 기다림으로 센다.
        synchronized(this){
            Entry sent=append(sendType,fields);Open next=new Open();
            next.label=requestLabel(sendType,fields);next.since=sent.at;next.size=size;
            next.phase=size!=null?"upload":"wait";next.waitSince=size!=null?null:sent.at;open=next;
        }
        changed(true);
    }
    void progress(long sent){
        synchronized(this){if(open==null)return;open.sent=sent;}
        changed(false);
    }
    void uploaded(){
        synchronized(this){if(open==null)return;open.phase="wait";open.waitSince=System.currentTimeMillis();}
        changed(true);
    }
    void close(){
        synchronized(this){if(open==null)return;open=null;}
        changed(true);
    }
    synchronized boolean lastIsFailure(){Entry last=entries.peekLast();return last!=null&&FAILURE_TYPES.contains(last.type);}
    synchronized List<Entry> entries(){return new ArrayList<>(entries);}

    static void failOnce(ActivityLog log,String reason){
        // 요청 쪽이 이미 실패 줄을 적었으면 더하지 않는다. 확인과 추가를 한 잠금 안에서 해 실패 줄이 겹치지 않게 한다.
        if(log==null)return;
        synchronized(log){if(log.lastIsFailure())return;log.append("failed",fields("reason",reason));}
        log.changed(true);
    }

    synchronized String json(){
        StringBuilder out=new StringBuilder("{\"id\":").append(text(id)).append(",\"kind\":").append(text(kind)).append(",\"location\":").append(text(location))
            .append(",\"meetingId\":").append(text(meetingId)).append(",\"resultId\":").append(text(resultId)).append(",\"entries\":[");
        boolean first=true;
        for(Entry entry:entries){
            if(!first)out.append(',');first=false;
            out.append("{\"seq\":").append(entry.seq).append(",\"at\":").append(entry.at).append(",\"type\":").append(text(entry.type)).append(",\"text\":").append(text(entry.text)).append('}');
        }
        out.append("],\"open\":");
        if(open==null)out.append("null");
        else out.append("{\"label\":").append(text(open.label)).append(",\"since\":").append(open.since).append(",\"phase\":").append(text(open.phase)).append(",\"sent\":").append(open.sent)
            .append(",\"size\":").append(open.size==null?"null":open.size.toString()).append(",\"waitSince\":").append(open.waitSince==null?"null":open.waitSince.toString()).append('}');
        return out.append('}').toString();
    }

    private Entry append(String type,Map<String,Object> fields){
        Entry entry=new Entry(++seq,System.currentTimeMillis(),type,lineText(type,fields));
        entries.addLast(entry);while(entries.size()>MAX_ENTRIES)entries.removeFirst();
        return entry;
    }
    private void changed(boolean structural){
        // 일지는 보여 주기 위한 기록이라 화면 알림이 실패해도 분석은 이어 간다.
        if(listener==null)return;
        try{listener.changed(structural);}catch(RuntimeException ignored){}
    }
    private static String text(String value){return value==null?"null":JsonText.quote(value);}

    static String lineText(String type,Map<String,Object> fields){
        Map<String,Object> f=fields==null?Collections.<String,Object>emptyMap():fields;
        switch(type==null?"":type){
            case "saveAudio":return "음성 저장함 · "+range(f)+"개";
            case "splitImport":return "녹음 파일 나눔 · "+value(f.get("total"))+"개";
            case "reuseTranscript":return "받아 둔 전사 씀 · 조각 "+range(f);
            case "reuseMinutes":return "받아 둔 회의록 씀 · 구간 "+range(f);
            case "sendTranscript":return "전사 요청 보냄 · 조각 "+range(f)+" · "+mb(f.get("bytes"))+"MB";
            case "recvTranscript":return "전사 받음 · 조각 "+range(f)+" · "+count(f.get("chars"))+"자";
            case "sendSummary":return "회의록 정리 요청 보냄 · 구간 "+range(f);
            case "recvSummary":return "회의록 정리 받음 · 구간 "+range(f);
            case "splitLimit":return "길이 한도에 닿아 나눠 다시 보냄 · 구간 "+value(f.get("part"));
            case "sendCompact":return "회의록 줄이기 요청 보냄";
            case "recvCompact":return "회의록 줄이기 받음";
            case "compactUnused":return "줄이기 결과를 못 써 원래 길이로 저장";
            case "sendRefine":return "의견 반영 요청 보냄 · 구간 "+range(f);
            case "recvRefine":return "의견 반영 받음 · 구간 "+range(f);
            case "timeout":return "응답 없음 · 5분 기다린 뒤 멈춤";
            case "uploadStall":return "음성 올리기 멈춤 · 1분 넘게 못 보냄";
            case "requestStall":return "요청 보내기 멈춤 · 1분 넘게 못 보냄";
            case "disconnected":return "실패 · 연결 끊김";
            case "apiError":return "실패 · OpenAI 오류 "+value(f.get("status"));
            case "badFormat":return "실패 · 응답 형식 오류";
            case "saveFailed":return "실패 · 저장하지 못함";
            case "failed":return "실패 · "+reasonText(f.get("reason"));
            case "canceled":return "분석 취소함";
            case "savedTranscript":return "전사 저장함";
            case "savedMinutes":return "회의록 저장함";
            default:return String.valueOf(type);
            // 모르는 종류로 화면이 멈추지 않게 종류 이름을 그대로 쓴다. 데스크톱 lineText와 같다.
        }
    }
    static String requestLabel(String sendType,Map<String,Object> fields){
        Map<String,Object> f=fields==null?Collections.<String,Object>emptyMap():fields;
        switch(sendType==null?"":sendType){
            case "sendTranscript":return "전사 · 조각 "+range(f);
            case "sendSummary":return "회의록 정리 · 구간 "+range(f);
            case "sendCompact":return "회의록 줄이기";
            case "sendRefine":return "의견 반영 · 구간 "+range(f);
            default:return lineText(sendType,fields);
        }
    }

    private static String range(Map<String,Object> f){return value(f.get("part"))+"/"+value(f.get("total"));}
    private static String value(Object value){
        // 숫자는 JavaScript 템플릿 문자열처럼 쓴다. 공통 예시를 읽은 1.0은 1로, 구간 번호 "2-1"은 글 그대로 쓴다.
        if(value instanceof Integer||value instanceof Long)return value.toString();
        if(value instanceof Number)return JsonText.numberText(((Number)value).doubleValue());
        return String.valueOf(value);
    }
    private static double number(Object value){
        double n=value instanceof Number?((Number)value).doubleValue():0;return Double.isNaN(n)?0:n;
    }
    static String mb(Object bytes){
        // 0.1MB 단위로 반올림하고, 0보다 크면 적어도 0.1MB로 쓴다. 데스크톱 mb와 같다.
        double value=number(bytes);if(value<=0)return "0.0";
        return String.format(Locale.ROOT,"%.1f",Math.max(0.1,Math.round(value/1048576*10)/10.0));
    }
    static String count(Object value){return String.format(Locale.US,"%,d",(long)Math.max(0,Math.floor(number(value))));}
    static String reasonText(Object reason){
        // 지금 쓰는 오류 문구에서 첫 문장만 쓰고, 40자를 넘으면 39자에 줄임표를 붙인다. 소수점(1.5MB)은 문장 끝으로 보지 않는다.
        String text=JsonText.trim(reason==null?"":String.valueOf(reason));
        if(text.isEmpty())return "알 수 없는 오류";
        int end=text.length();
        for(int i=0;i<text.length();i++)if(text.charAt(i)=='.'&&(i+1==text.length()||JsonText.space(text.charAt(i+1)))){end=i;break;}
        String sentence=JsonText.trim(text.substring(0,end));if(sentence.isEmpty())sentence=text;
        return sentence.length()>40?sentence.substring(0,39)+"…":sentence;
    }
}
