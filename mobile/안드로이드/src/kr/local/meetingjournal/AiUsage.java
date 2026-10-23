// 회의 한 건의 AI 호출 사용량을 종류·모델별로 누적하고 옛 기록을 안전하게 해석한다.
package kr.local.meetingjournal;
import java.util.*;

final class AiUsage {
    static final String SUMMARY="summary",TRANSCRIPTION="transcription";
    static final class Measured {
        // 캐시·추론 토큰은 입력·출력 토큰에 이미 포함된 내역이므로 합계에 더하지 않는다.
        final long input,output,total,cached,reasoning;
        private Measured(long input,long output,long total,long cached,long reasoning){this.input=input;this.output=output;this.total=total;this.cached=cached;this.reasoning=reasoning;}
        static Measured of(Long input,Long output,Long total,Long cached,Long reasoning){
            if(!count(input)||!count(output))return null;
            return new Measured(input,output,count(total)?total:input+output,count(cached)?cached:0,count(reasoning)?reasoning:0);
        }
    }
    static final class Entry {
        final String kind,model;long requests,measuredRequests,unknownRequests,inputTokens,outputTokens,totalTokens,cachedInputTokens,reasoningTokens;double audioSeconds;
        Entry(String kind,String model){this.kind=kind;this.model=model;}
    }
    static boolean count(Long value){return value!=null&&value>=0;}
    static boolean validModel(String model){return model!=null&&model.matches("[A-Za-z0-9._:-]{1,100}");}
    static boolean validKind(String kind){return SUMMARY.equals(kind)||TRANSCRIPTION.equals(kind);}
    static long or0(Long value){return count(value)?value:0;}
    static Entry restore(String kind,String model,Long requests,Long measured,Long unknown,Long input,Long output,Long total,Long cached,Long reasoning,Double seconds){
        // 측정 건수가 없는 옛 기록은 토큰 값이 있으면 모두 측정, 없으면 모두 미확인으로 본다.
        if(!validModel(model))return null;if(kind==null)kind=SUMMARY;if(!validKind(kind))return null;
        Entry entry=new Entry(kind,model);long all=or0(requests);boolean hasTokens=count(input)&&count(output);double audio=seconds!=null&&seconds>=0&&!seconds.isInfinite()&&!seconds.isNaN()?seconds:0;
        if(!count(measured)&&!count(unknown)){entry.measuredRequests=hasTokens||audio>0?all:0;entry.unknownRequests=all-entry.measuredRequests;}
        else{entry.measuredRequests=or0(measured);entry.unknownRequests=or0(unknown);}
        entry.requests=Math.max(all,entry.measuredRequests+entry.unknownRequests);
        entry.inputTokens=or0(input);entry.outputTokens=or0(output);entry.totalTokens=count(total)?total:entry.inputTokens+entry.outputTokens;
        entry.cachedInputTokens=or0(cached);entry.reasoningTokens=or0(reasoning);entry.audioSeconds=audio;return entry;
    }
    static Entry find(List<Entry> ledger,String kind,String model){for(Entry entry:ledger)if(entry.kind.equals(kind)&&entry.model.equals(model))return entry;return null;}
    static void merge(List<Entry> ledger,Entry entry){
        if(entry==null)return;Entry same=find(ledger,entry.kind,entry.model);if(same==null){if(ledger.size()<50)ledger.add(entry);return;}
        same.requests+=entry.requests;same.measuredRequests+=entry.measuredRequests;same.unknownRequests+=entry.unknownRequests;same.inputTokens+=entry.inputTokens;same.outputTokens+=entry.outputTokens;
        same.totalTokens+=entry.totalTokens;same.cachedInputTokens+=entry.cachedInputTokens;same.reasoningTokens+=entry.reasoningTokens;same.audioSeconds+=entry.audioSeconds;
    }
    static Entry add(List<Entry> ledger,String kind,String model,Measured usage,Double seconds){
        // OpenAI로 보낸 호출만 넘긴다. 사용량이 없는 호출은 0이 아니라 미확인 건수로 남긴다.
        if(!validKind(kind)||!validModel(model))return null;Entry entry=find(ledger,kind,model);if(entry==null){entry=new Entry(kind,model);ledger.add(entry);}
        entry.requests++;boolean audio=seconds!=null&&seconds>=0&&!seconds.isInfinite()&&!seconds.isNaN();
        if(usage==null&&!audio){entry.unknownRequests++;return entry;}
        entry.measuredRequests++;
        if(usage!=null){entry.inputTokens+=usage.input;entry.outputTokens+=usage.output;entry.totalTokens+=usage.total;entry.cachedInputTokens+=usage.cached;entry.reasoningTokens+=usage.reasoning;}
        if(audio)entry.audioSeconds+=seconds;return entry;
    }
}
