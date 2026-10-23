// Windows 앱과 같은 요약 모델 목록과 모델별 요청 상한을 제공한다.
package kr.local.meetingjournal;
import java.util.*;

final class AiModels {
    // 근거: developers.openai.com/api/docs/models/<id> (2026-10-02 확인). 세 모델 모두 Responses API·Structured Outputs를 지원하고 최대 출력은 128,000토큰이다.
    // GPT-6.1 계열은 Sol만 있어 Luna·Astra는 GPT-6 판을 쓴다. 이전 기본 GPT-6 Sol과 GPT-5.6 Terra는 목록에서 뺐다.
    static final String DEFAULT_MODEL="gpt-6.1-sol";
    static final String TRANSCRIPTION_MODEL="gpt-transcribe";
    static final int OUTPUT_TOKENS=32000;
    static final class Model {
        final String id,label,description,reasoningEffort;final int modelMaxOutputTokens,maxOutputTokens;
        Model(String id,String label,String description,int modelMaxOutputTokens){this.id=id;this.label=label;this.description=description;this.modelMaxOutputTokens=modelMaxOutputTokens;maxOutputTokens=Math.min(OUTPUT_TOKENS,modelMaxOutputTokens);reasoningEffort="medium";}
    }
    static final List<Model> ALL=Collections.unmodifiableList(Arrays.asList(
        new Model("gpt-6.1-sol","GPT-6.1 Sol (기본)","기본 요약 모델입니다. 품질과 요금이 중간입니다.",128000),
        new Model("gpt-6-luna","GPT-6 Luna","가장 저렴하고 빠른 모델입니다. 긴 회의는 정리 품질을 확인하세요.",128000),
        new Model("gpt-6-astra","GPT-6 Astra","가장 정확하지만 요금이 Sol의 약 5배입니다.",128000)));
    static Model find(String id){if(id==null)return null;for(Model model:ALL)if(model.id.equals(id))return model;return null;}
}
