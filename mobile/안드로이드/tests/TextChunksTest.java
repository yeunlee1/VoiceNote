// 긴 전사의 분할 상한과 유니코드 문자 및 공백 보존을 검증한다.
package kr.local.meetingjournal;
import java.util.*;
public final class TextChunksTest {
    public static void main(String[] args){for(int length:new int[]{0,1,1999,24000,29956,90000}){StringBuilder input=new StringBuilder();while(input.length()<length)input.append(" 😀 제조지시서 확인.\n");String text=input.toString();for(int limit:new int[]{2000,7490,24000}){List<String> chunks=TextChunks.split(text,limit);if(!String.join("",chunks).equals(text))throw new AssertionError("원문 손실");for(String chunk:chunks){if(chunk.length()>limit)throw new AssertionError("입력 상한 초과");if(!chunk.isEmpty()&&Character.isHighSurrogate(chunk.charAt(chunk.length()-1)))throw new AssertionError("문자 경계 손실");}}}System.out.println("전사 분할 18개 조합 통과");}
}
