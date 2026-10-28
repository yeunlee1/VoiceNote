// 내 형식 검증 결과와 AI 지시문을 한 줄씩 출력해 데스크톱 출력형식.js와 비교하게 한다.
package kr.local.meetingjournal;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class CustomFormatTest {
    public static void main(String[] args) throws Exception {
        // 입력 파일의 각 줄은 JSON 하나다. 결과도 한 줄에 하나씩 {"ok":...} 형태로 쓴다.
        List<String> lines=Files.readAllLines(Paths.get(args[0]),StandardCharsets.UTF_8);StringBuilder out=new StringBuilder();
        for(String line:lines){
            if(line.isEmpty())continue;
            try{CustomFormat value=CustomFormat.parse(line);out.append("{\"ok\":true,\"value\":").append(value.json()).append(",\"instruction\":").append(JsonText.quote(value.instruction())).append("}\n");}
            catch(java.io.IOException ex){out.append("{\"ok\":false,\"message\":").append(JsonText.quote(ex.getMessage())).append("}\n");}
        }
        Files.write(Paths.get(args[1]),out.toString().getBytes(StandardCharsets.UTF_8));
    }
}
