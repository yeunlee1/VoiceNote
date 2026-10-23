// 설정 교환 파일의 쓰기·읽기 왕복과 거절해야 하는 입력을 PC의 JVM에서 검증한다.
package kr.local.meetingjournal;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class SettingsExchangeTest {
    static int checks;
    static void expect(boolean ok,String label){if(!ok)throw new AssertionError(label);checks++;}
    static String repeat(char c,int n){char[] a=new char[n];Arrays.fill(a,c);return new String(a);}
    static List<SettingsExchange.Project> sample(){
        List<SettingsExchange.Project> all=new ArrayList<>();
        for(int i=9;i>=1;i--)all.add(i==1?new SettingsExchange.Project(1,"예시 프로젝트 \"표준\" 😀","제목\t탭","첫 줄\n둘째 줄\r\n\\ /   끝","tasks")
            :i==4?new SettingsExchange.Project(4,"요약 프로젝트","","설명","summary"):new SettingsExchange.Project(i,"","","","meeting"));
        return all;
    }
    static String entry(int slot,String extra){return "{\"slot\":"+slot+",\"name\":\"\",\"title\":\"\",\"context\":\"\",\"outputFormat\":\"meeting\""+extra+"}";}
    static String doc(String root,String... entries){return "{\"format\":\"voicenote-project-settings\",\"version\":1,\"projects\":["+String.join(",",entries)+"]"+root+"}";}
    static String[] nine(){String[] e=new String[9];for(int i=0;i<9;i++)e[i]=entry(i+1,"");return e;}
    static void rejects(String json,String label,String reason){
        try{SettingsExchange.read(json.getBytes(StandardCharsets.UTF_8));throw new AssertionError("must reject: "+label);}
        catch(IOException ex){expect(ex.getMessage().contains(reason)&&ex.getMessage().contains("기존 설정은 바뀌지 않았습니다"),label+" → "+ex.getMessage());}
    }
    public static void main(String[] args) throws Exception {
        // 데스크톱 호환 검사(설정호환.test.cjs)가 쓰는 모드다. 파일을 읽어 다시 쓰거나, 파일마다 받아들이는지 판정만 출력한다.
        if(args.length==3&&args[0].equals("--roundtrip")){Files.write(Paths.get(args[2]),SettingsExchange.write(SettingsExchange.read(Files.readAllBytes(Paths.get(args[1])))));return;}
        if(args.length>1&&args[0].equals("--verdict")){
            for(int i=1;i<args.length;i++){String verdict;try{SettingsExchange.read(Files.readAllBytes(Paths.get(args[i])));verdict="accept";}catch(IOException ex){verdict="reject";}System.out.println(Paths.get(args[i]).getFileName()+" "+verdict);}
            return;
        }
        byte[] bytes=SettingsExchange.write(sample());String text=new String(bytes,StandardCharsets.UTF_8);
        expect(text.indexOf("\"slot\": 1")<text.indexOf("\"slot\": 2")&&text.indexOf("\"slot\": 8")<text.indexOf("\"slot\": 9"),"slots sorted");
        expect(!text.contains("apiKey")&&!text.contains("model")&&!text.contains("revision"),"no key/model/revision fields");
        List<SettingsExchange.Project> back=SettingsExchange.read(bytes);
        expect(back.size()==9&&back.get(0).name.equals("예시 프로젝트 \"표준\" 😀")&&back.get(0).context.equals("첫 줄\n둘째 줄\r\n\\ /   끝")&&back.get(0).title.equals("제목\t탭"),"unicode and multiline preserved");
        expect(back.get(0).outputFormat.equals("tasks")&&back.get(3).outputFormat.equals("summary")&&back.get(8).outputFormat.equals("meeting"),"output formats preserved");
        expect(Arrays.equals(SettingsExchange.write(back),bytes),"write → read → write is byte-identical");
        // 데스크톱(JSON.stringify)처럼 공백 없이 쓰고 순서가 섞인 파일도 slot 기준으로 읽는다.
        String[] shuffled=nine();Collections.reverse(Arrays.asList(shuffled));
        expect(SettingsExchange.read(doc("",shuffled).getBytes(StandardCharsets.UTF_8)).get(0).slot==1,"compact reversed file accepted and sorted");
        expect(SettingsExchange.read(("﻿"+doc("",nine())).getBytes(StandardCharsets.UTF_8)).size()==9,"UTF-8 BOM accepted");
        String[] escaped=nine();escaped[2]="{\"slot\":3.0,\"name\":\"\\uD55C\\uAE00\\/\",\"title\":\"\",\"context\":\"\",\"outputFormat\":\"summary\"}";
        SettingsExchange.Project third=SettingsExchange.read(doc("",escaped).getBytes(StandardCharsets.UTF_8)).get(2);
        expect(third.name.equals("한글/")&&third.outputFormat.equals("summary"),"escapes decoded, integral 3.0 accepted");
        // 데스크톱 계약: 이름 없는 슬롯의 공백뿐인 제목·설명은 비우고, 이름 있는 슬롯은 이름·제목 앞뒤 공백만 지운다.
        String[] blanks=nine();blanks[5]="{\"slot\":6,\"name\":\"  \",\"title\":\" \\t\",\"context\":\"\\n \",\"outputFormat\":\"meeting\"}";
        blanks[6]="{\"slot\":7,\"name\":\"  이름  \",\"title\":\" 제목 \",\"context\":\"  설명 원문\\n \",\"outputFormat\":\"summary\"}";
        List<SettingsExchange.Project> trimmed=SettingsExchange.read(doc("",blanks).getBytes(StandardCharsets.UTF_8));
        expect(trimmed.get(5).name.isEmpty()&&trimmed.get(5).title.isEmpty()&&trimmed.get(5).context.isEmpty()&&trimmed.get(5).outputFormat.equals("meeting"),"whitespace-only empty slot normalized");
        expect(trimmed.get(6).name.equals("이름")&&trimmed.get(6).title.equals("제목")&&trimmed.get(6).context.equals("  설명 원문\n ")&&trimmed.get(6).outputFormat.equals("summary"),"name/title trimmed, context kept verbatim");
        String[] wide=nine();wide[1]="{\"slot\":2,\"name\":\"\\u3000\\u00a0\",\"title\":\"\\u2003\",\"context\":\"\\ufeff\",\"outputFormat\":\"meeting\"}";
        wide[2]="{\"slot\":3,\"name\":\"\\u00a0이름\\u3000\",\"title\":\"\\u202f제목\\u2028\",\"context\":\"\\u3000설명\",\"outputFormat\":\"meeting\"}";
        wide[3]="{\"slot\":4,\"name\":\"\\u0001\",\"title\":\"\",\"context\":\"\",\"outputFormat\":\"meeting\"}";
        List<SettingsExchange.Project> wideRead=SettingsExchange.read(doc("",wide).getBytes(StandardCharsets.UTF_8));
        expect(wideRead.get(1).name.isEmpty()&&wideRead.get(2).name.equals("이름")&&wideRead.get(2).title.equals("제목")&&wideRead.get(2).context.equals("\u3000설명"),"JS trim whitespace set (ideographic, NBSP, line separator)");
        expect(wideRead.get(3).name.equals("\u0001"),"control character kept like JS trim");
        List<SettingsExchange.Project> lone=new ArrayList<>(sample());lone.set(0,new SettingsExchange.Project(9,"가\ud800나","\udc00","😀\ud83d","meeting"));
        String loneText=new String(SettingsExchange.write(lone),StandardCharsets.UTF_8);
        expect(loneText.contains("가\\ud800나")&&loneText.contains("\\udc00")&&loneText.contains("😀\\ud83d")&&!loneText.contains("?"),"lone surrogates escaped, pairs kept");
        expect(SettingsExchange.read(loneText.getBytes(StandardCharsets.UTF_8)).get(8).name.equals("가\ud800나"),"lone surrogate survives roundtrip");
        String[] full=nine();full[0]="{\"slot\":1,\"name\":\""+repeat('가',100)+"\",\"title\":\""+repeat('나',160)+"\",\"context\":\""+repeat('다',4000)+"\",\"outputFormat\":\"meeting\"}";
        expect(SettingsExchange.read(doc("",full).getBytes(StandardCharsets.UTF_8)).get(0).context.length()==4000,"maximum lengths accepted");

        String[] e;
        rejects(doc("",Arrays.copyOf(nine(),8)),"8 projects","정확히 9개");
        e=nine();e[8]=entry(1,"");rejects(doc("",e),"duplicate slot","중복");
        e=nine();e[8]=entry(10,"");rejects(doc("",e),"slot 10","1부터 9까지");
        e=nine();e[8]=entry(0,"");rejects(doc("",e),"slot 0","1부터 9까지");
        e=nine();e[0]=entry(1,"").replace("\"slot\":1","\"slot\":\"1\"");rejects(doc("",e),"string slot","정수");
        e=nine();e[0]=entry(1,"").replace("\"slot\":1","\"slot\":1.5");rejects(doc("",e),"fractional slot","정수");
        e=nine();e[0]=entry(1,",\"apiKey\":\"x\"");rejects(doc("",e),"entry extra key","apiKey");
        e=nine();e[0]="{\"slot\":1,\"name\":\"\",\"context\":\"\",\"outputFormat\":\"meeting\"}";rejects(doc("",e),"missing title","title");
        rejects(doc(",\"model\":\"gpt\"",nine()),"root extra key","model");
        rejects(doc("",nine()).replace("voicenote-project-settings","other"),"wrong format","VoiceNote");
        rejects(doc("",nine()).replace("\"version\":1","\"version\":2"),"version 2","버전");
        e=nine();e[0]=entry(1,"").replace("\"meeting\"","\"minutes\"");rejects(doc("",e),"bad outputFormat","출력 형식");
        e=nine();e[0]=entry(1,"").replace("\"title\":\"\"","\"title\":\"남은 제목\"");rejects(doc("",e),"blank name with title","이름이 비어");
        e=nine();e[0]=entry(1,"").replace("\"context\":\"\"","\"context\":\"설명\"");rejects(doc("",e),"blank name with context","이름이 비어");
        e=nine();e[0]=entry(1,"").replace("\"meeting\"","\"tasks\"");rejects(doc("",e),"blank name with tasks format","meeting이어야");
        rejects(doc("",nine()).replace("\"version\":1","\"version\":true"),"boolean version","정수");
        rejects(doc("",nine()).replace("\"version\":1","\"version\":\"1\""),"string version","정수");
        e=nine();e[0]="{\"slot\":1,\"name\":\""+repeat('가',101)+"\",\"title\":\"\",\"context\":\"\",\"outputFormat\":\"meeting\"}";rejects(doc("",e),"name 101","100자");
        e=nine();e[0]="{\"slot\":1,\"name\":\"A\",\"title\":\""+repeat('가',161)+"\",\"context\":\"\",\"outputFormat\":\"meeting\"}";rejects(doc("",e),"title 161","160자");
        e=nine();e[0]="{\"slot\":1,\"name\":\"A\",\"title\":\"\",\"context\":\""+repeat('가',4001)+"\",\"outputFormat\":\"meeting\"}";rejects(doc("",e),"context 4001","4,000자");
        e=nine();e[0]="{\"slot\":1,\"name\":null,\"title\":\"\",\"context\":\"\",\"outputFormat\":\"meeting\"}";rejects(doc("",e),"null name","문자열");
        rejects(doc("",nine())+"x","trailing garbage","문법");
        rejects(doc("",nine()).replace("]",",]"),"trailing comma","문법");
        rejects(doc("",nine()).replace("\"format\"","'format'"),"single quotes","문법");
        rejects("// 주석\n"+doc("",nine()),"comment","문법");
        rejects(doc("",nine()).replace("{\"format\"","{\"version\":1,\"format\""),"duplicate key","두 번");
        rejects("[]","array root","객체");
        rejects("","empty file","문법");
        rejects(doc("",nine()).replace("\"name\":\"\"","\"name\":\"a\nb\""),"raw newline in string","문법");
        try{SettingsExchange.read(new byte[]{'{',(byte)0xC3,(byte)0x28,'}'});throw new AssertionError("bad utf8");}catch(IOException ex){expect(ex.getMessage().contains("UTF-8"),"invalid UTF-8 rejected");}
        byte[] big=new byte[SettingsExchange.MAX_BYTES+1];Arrays.fill(big,(byte)' ');
        try{SettingsExchange.read(big);throw new AssertionError("oversize");}catch(IOException ex){expect(ex.getMessage().contains("128KiB"),"oversize rejected before parsing");}
        byte[] exact=(doc("",nine())+repeat(' ',SettingsExchange.MAX_BYTES)).substring(0,SettingsExchange.MAX_BYTES).getBytes(StandardCharsets.UTF_8);
        expect(exact.length==SettingsExchange.MAX_BYTES&&SettingsExchange.read(exact).size()==9,"exactly 128KiB accepted");
        expect(SettingsExchange.outputFormat(null).equals("meeting")&&SettingsExchange.outputFormat("tasks").equals("tasks")&&SettingsExchange.outputFormat("x").equals("meeting"),"old data without format reads as meeting");

        if(args.length>0){Path out=Paths.get(args[0]);Files.createDirectories(out);Files.write(out.resolve("모바일-내보내기-예시.json"),bytes);}
        System.out.println("PASS "+checks+" settings exchange checks");
    }
}
