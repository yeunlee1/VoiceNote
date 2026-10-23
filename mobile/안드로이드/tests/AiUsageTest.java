// 요약 모델 목록과 회의별 AI 사용량 누적·옛 기록 해석을 안드로이드 없이 검증한다.
package kr.local.meetingjournal;
import java.util.*;
public final class AiUsageTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    public static void main(String[] args){
        List<String> ids=new ArrayList<>();for(AiModels.Model m:AiModels.ALL){ids.add(m.id);expect(m.maxOutputTokens==32000&&m.maxOutputTokens<=m.modelMaxOutputTokens,"모델별 요청 상한 "+m.id);expect(m.reasoningEffort.equals("medium"),"추론 강도 "+m.id);}
        expect(ids.equals(Arrays.asList("gpt-6.1-sol","gpt-6-luna","gpt-6-astra")),"데스크톱과 같은 모델 순서");
        expect(AiModels.DEFAULT_MODEL.equals("gpt-6.1-sol")&&AiModels.find("gpt-6.1-sol")!=null&&AiModels.find("gpt-6-sol")==null,"GPT-6.1 Sol 기본, 이전 모델 제외");
        expect(AiModels.find("gpt-retired")==null&&AiModels.find(null)==null,"모르는 모델은 대체하지 않음");
        List<AiUsage.Entry> ledger=new ArrayList<>();
        AiUsage.add(ledger,AiUsage.SUMMARY,"gpt-6-sol",AiUsage.Measured.of(1000L,300L,1300L,200L,250L),null);
        AiUsage.add(ledger,AiUsage.SUMMARY,"gpt-6-sol",null,null);
        AiUsage.add(ledger,AiUsage.SUMMARY,"gpt-6-sol",AiUsage.Measured.of(600L,200L,null,null,null),null);
        AiUsage.add(ledger,AiUsage.SUMMARY,"gpt-6-luna",AiUsage.Measured.of(50L,5L,55L,0L,0L),null);
        AiUsage.add(ledger,AiUsage.TRANSCRIPTION,"gpt-transcribe",null,90.5);
        AiUsage.Entry sol=AiUsage.find(ledger,AiUsage.SUMMARY,"gpt-6-sol");
        expect(sol.requests==3&&sol.measuredRequests==2&&sol.unknownRequests==1,"분할·실패·재시도 건수 누적");
        expect(sol.inputTokens==1600&&sol.outputTokens==500&&sol.totalTokens==2100,"입력·출력·합계 누적");
        expect(sol.cachedInputTokens==200&&sol.reasoningTokens==250,"캐시·추론은 포함 내역으로만 누적");
        expect(AiUsage.find(ledger,AiUsage.SUMMARY,"gpt-6-luna").totalTokens==55,"모델별 분리");
        AiUsage.Entry audio=AiUsage.find(ledger,AiUsage.TRANSCRIPTION,"gpt-transcribe");
        expect(audio.measuredRequests==1&&audio.totalTokens==0&&audio.audioSeconds==90.5,"전사는 요약과 분리하고 초 단위로 기록");
        expect(AiUsage.Measured.of(-1L,5L,null,null,null)==null&&AiUsage.Measured.of(null,5L,null,null,null)==null,"잘못된 사용량은 측정값으로 보지 않음");
        expect(AiUsage.add(ledger,"image","gpt-6-sol",null,null)==null&&AiUsage.add(ledger,AiUsage.SUMMARY,"../x",null,null)==null,"잘못된 종류·모델 거절");
        AiUsage.Entry oldNull=AiUsage.restore(null,"gpt-6-sol",2L,null,null,null,null,null,null,null,null);
        expect(oldNull.kind.equals("summary")&&oldNull.unknownRequests==2&&oldNull.measuredRequests==0,"토큰 없는 옛 기록은 미확인");
        AiUsage.Entry oldTokens=AiUsage.restore(null,"gpt-6-sol",1L,null,null,100L,20L,null,null,null,null);
        expect(oldTokens.measuredRequests==1&&oldTokens.totalTokens==120,"토큰 있는 옛 기록은 측정");
        expect(AiUsage.restore(null,null,1L,null,null,null,null,null,null,null,null)==null&&AiUsage.restore("bad","gpt-6-sol",1L,null,null,null,null,null,null,null,null)==null,"깨진 옛 항목 무시");
        List<AiUsage.Entry> merged=new ArrayList<>();AiUsage.merge(merged,oldNull);AiUsage.merge(merged,oldTokens);
        expect(merged.size()==1&&merged.get(0).requests==3&&merged.get(0).unknownRequests==2,"같은 모델 옛 항목 병합");
        System.out.println("AI 모델·사용량 "+checks+"개 검증 통과");
    }
}
