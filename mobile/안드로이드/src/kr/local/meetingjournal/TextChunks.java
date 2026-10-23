// 전사를 손실 없이 나누고 유니코드 문자 경계를 보존한다.
package kr.local.meetingjournal;
import java.util.*;
final class TextChunks {
    static List<String> split(String text,int maximum) {
        if(maximum<2)throw new IllegalArgumentException("구간 크기 오류");List<String> result=new ArrayList<>();
        for(int start=0;start<text.length();){int end=Math.min(text.length(),start+maximum);
            if(end<text.length()&&Character.isHighSurrogate(text.charAt(end-1)))end--;
            if(end<text.length()){for(int i=end;i>start+maximum/2;i--){char c=text.charAt(i-1);if(c=='\n'||c=='.'||c=='?'||c=='!'){end=i;break;}}}
            result.add(text.substring(start,end));start=end;
        }return result;
    }
}
