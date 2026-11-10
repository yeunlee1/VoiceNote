// 할 일 규칙의 결과를 한 줄씩 출력해 데스크톱 할일정리.js와 비교하게 한다.
package kr.local.meetingjournal;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class TodosTest {
    private static String decode(String value){return value.equals("-")?null:new String(Base64.getDecoder().decode(value),StandardCharsets.UTF_8);}
    private static String encode(String value){return value==null?"-":Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));}
    private static List<Todos.Item> items(String text){
        List<Todos.Item> list=new ArrayList<>();if(text.isEmpty())return list;
        for(String row:text.split(",")){String[] f=row.split(":");list.add(new Todos.Item(decode(f[0]),decode(f[1]),decode(f[2]),f[3].equals("1")));}
        return list;
    }
    private static String order(int[] values){StringBuilder out=new StringBuilder();for(int value:values)out.append(out.length()==0?"":",").append(value);return out.toString();}
    public static void main(String[] args) throws Exception {
        // 입력은 "P 참석자", "S 항목", "O 완료여부 항목 AI항목", "C 완료여부 이전AI 수정본 새항목", "K 참석자 항목", "M 참석자 항목 저장된선택 설정이름"이다. 결과도 한 줄에 하나씩 쓴다.
        StringBuilder out=new StringBuilder();
        for(String line:Files.readAllLines(Paths.get(args[0]),StandardCharsets.UTF_8)){
            if(line.isEmpty())continue;
            String[] parts=line.split(" ",-1);
            if(parts[0].equals("P")){StringBuilder names=new StringBuilder();for(String name:Todos.people(decode(parts[1])))names.append(names.length()==0?"":",").append(encode(name));out.append(names).append('\n');}
            else if(parts[0].equals("S"))out.append(order(Todos.sortedOrder(items(parts[1])))).append('\n');
            else if(parts[0].equals("O"))out.append(order(Todos.outputOrder(parts[1].equals("1"),items(parts[2]),items(parts[3])))).append('\n');
            else if(parts[0].equals("K")){StringBuilder names=new StringBuilder();for(String name:Todos.candidates(decode(parts[1]),items(parts[2])))names.append(names.length()==0?"":",").append(encode(name));out.append(names).append('\n');}
            else if(parts[0].equals("M")){
                // 나는 후보의 표기로, 내가 안 끝낸 일의 수는 모르면 null로 쓴다.
                List<Todos.Item> list=items(parts[2]);String participants=decode(parts[1]),saved=decode(parts[3]),settings=decode(parts[4]);
                int open=Todos.mineOpen(participants,list,saved,settings);
                out.append(encode(Todos.resolveMe(Todos.candidates(participants,list),saved,settings))).append(';').append(open<0?"null":String.valueOf(open)).append('\n');
            }
            else{
                Todos.Carried carried=Todos.carryOver(items(parts[2]),parts[1].equals("1"),items(parts[3]),items(parts[4]));
                if(carried==null){out.append("null\n");continue;}
                StringBuilder rows=new StringBuilder(carried.finalized?"1;":"0;");boolean first=true;
                for(Todos.Item item:carried.items){rows.append(first?"":",").append(encode(item.task)).append(':').append(encode(item.owner)).append(':').append(encode(item.due)).append(':').append(item.done?"1":"0");first=false;}
                out.append(rows).append('\n');
            }
        }
        Files.write(Paths.get(args[1]),out.toString().getBytes(StandardCharsets.UTF_8));
    }
}
