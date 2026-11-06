// 결과 길이 목표와 참석자 이름 힌트 규칙을 데스크톱 출력형식.js와 같게 둔다.
package kr.local.meetingjournal;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

final class SummaryRules {
    private SummaryRules(){}
    // Android 9 이하는 정규식의 문자 체계 이름(Is 접두사)을 읽지 못하므로 데스크톱 출력형식.js와 같은 번호 범위를 쓴다.
    private static final Pattern FOREIGN_SCRIPT=foreignScript();
    private static Pattern foreignScript(){
        // 이 정규식을 읽지 못하는 기기가 있어도 앱이 멈추지 않게 지우기만 건너뛴다.
        try{return Pattern.compile("[\\u2E80-\\u2FDF\\u3005-\\u3007\\u3021-\\u3029\\u3038-\\u303B\\u3040-\\u309F\\u30A0-\\u30FA\\u30FC-\\u30FF\\u31F0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF66-\\uFF9F\\x{1B000}-\\x{1B16F}\\x{20000}-\\x{323AF}]+");}catch(RuntimeException ex){return null;}
    }
    static String withoutForeignText(String value){
        // AI가 결과에 섞어 쓴 일본어·중국어 글자를 지운다. 데스크톱 출력형식.js withoutForeignText와 같은 규칙이다.
        if(value==null||FOREIGN_SCRIPT==null||!FOREIGN_SCRIPT.matcher(value).find())return value;
        return FOREIGN_SCRIPT.matcher(value).replaceAll("").replaceAll("·{2,}","·").replaceAll(" {2,}"," ").replaceAll("^ +| +$","");
    }
    static int goal(String format){
        if("summary".equals(format))return 1000;
        if("tasks".equals(format))return 2000;
        return 3000;
    }
    static int compactTarget(String format,int body,int kept){
        // 결과가 목표의 1.2배를 넘고 줄일 본문이 남아 있으면 본문에 허용할 글자 수를, 아니면 0을 돌려준다.
        int goal=goal(format);
        if(body+kept<=goal*6/5)return 0;
        int target=Math.max(goal/2,goal-kept);
        return body>target?target:0;
    }
    static List<String> participantKeywords(String value){
        // 꺾쇠·줄바꿈이 들어가면 OpenAI가 요청 전체를 거절하므로 글자·숫자·밑줄·하이픈만 남긴다.
        List<String> words=new ArrayList<>();
        if(value==null)return words;
        for(String piece:value.split("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF,，、;；/|·・]+")){
            String word=piece.replaceAll("[^\\p{L}\\p{N}_-]","");
            if(word.length()<2||word.length()>30||words.contains(word))continue;
            words.add(word);
            if(words.size()==20)break;
        }
        return words;
    }
}
