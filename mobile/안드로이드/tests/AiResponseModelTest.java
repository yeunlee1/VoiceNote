// 사용량 원장이 응답의 실제 모델을 우선 기록하고 없을 때만 요청 모델을 쓰는지 검증한다.
package kr.local.meetingjournal;
public final class AiResponseModelTest {
    static int checks;
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    public static void main(String[] args){
        expect(Ai.usageModel("gpt-6-sol-2026-04-20","gpt-6-sol").equals("gpt-6-sol-2026-04-20"),"응답 스냅샷 모델 우선");
        expect(Ai.usageModel("gpt-6.1-sol","gpt-6-sol").equals("gpt-6.1-sol"),"응답 모델이 요청과 달라도 실제 모델 기록");
        expect(Ai.usageModel(null,"gpt-6-luna").equals("gpt-6-luna"),"응답 모델 없으면 요청 모델");
        expect(Ai.usageModel("","gpt-6-luna").equals("gpt-6-luna"),"빈 응답 모델은 요청 모델");
        expect(Ai.usageModel("../bad model","gpt-6-astra").equals("gpt-6-astra"),"형식이 틀린 응답 모델은 요청 모델");
        expect(Ai.usageModel(new String(new char[101]).replace('\0','a'),"gpt-6-sol").equals("gpt-6-sol"),"너무 긴 응답 모델은 요청 모델");
        System.out.println("응답 모델 기록 "+checks+"개 검증 통과");
    }
}
