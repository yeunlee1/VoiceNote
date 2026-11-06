// 결과 길이 판정과 참석자 이름 힌트를 한 줄씩 출력해 데스크톱 출력형식.js와 비교하게 한다.
package kr.local.meetingjournal;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class SummaryRulesTest {
    public static void main(String[] args) throws Exception {
        // 입력의 각 줄은 "T 형식 본문 목록", "K 참석자칸(base64)", "F 글(base64)"이다. 결과도 한 줄에 하나씩 쓴다.
        StringBuilder out=new StringBuilder();
        for(String line:Files.readAllLines(Paths.get(args[0]),StandardCharsets.UTF_8)){
            if(line.isEmpty())continue;
            String[] parts=line.split(" ",-1);
            if(parts[0].equals("T"))out.append(SummaryRules.compactTarget(parts[1],Integer.parseInt(parts[2]),Integer.parseInt(parts[3]))).append('\n');
            else if(parts[0].equals("F"))out.append(JsonText.quote(SummaryRules.withoutForeignText(new String(Base64.getDecoder().decode(parts[1]),StandardCharsets.UTF_8)))).append('\n');
            else{
                List<String> quoted=new ArrayList<>();
                for(String word:SummaryRules.participantKeywords(new String(Base64.getDecoder().decode(parts[1]),StandardCharsets.UTF_8)))quoted.add(JsonText.quote(word));
                out.append('[').append(String.join(",",quoted)).append("]\n");
            }
        }
        Files.write(Paths.get(args[1]),out.toString().getBytes(StandardCharsets.UTF_8));
    }
}
