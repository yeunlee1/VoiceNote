// 프로젝트 설정(교환 파일 9칸, 앱은 3개)을 데스크톱과 같은 교환 파일(JSON)로 쓰고, 불러온 파일은 저장 전에 엄격하게 모두 검증한다.
package kr.local.meetingjournal;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;

final class SettingsExchange {
    static final String FORMAT="voicenote-project-settings";
    static final int VERSION=1,SLOTS=9,MAX_BYTES=128*1024,NAME_MAX=100,TITLE_MAX=160,CONTEXT_MAX=4000;
    static final List<String> OUTPUT_FORMATS=Collections.unmodifiableList(Arrays.asList("meeting","summary","tasks"));
    static final Set<String> ROOT_KEYS=new HashSet<>(Arrays.asList("format","version","projects"));
    static final Set<String> PROJECT_KEYS=new HashSet<>(Arrays.asList("slot","name","title","context","outputFormat"));

    static final class Project {
        final int slot; final String name,title,context,outputFormat;
        Project(int slot,String name,String title,String context,String outputFormat){this.slot=slot;this.name=name;this.title=title;this.context=context;this.outputFormat=outputFormat;}
        boolean empty(){return trim(name).isEmpty();}
    }

    static boolean space(char c){
        // JavaScript String.prototype.trim이 지우는 공백·줄바꿈 집합이다. Java trim과 달리 제어문자는 남기고 전각·NBSP 공백은 지운다.
        switch(c){case '\t':case '\n':case 0x0B:case '\f':case '\r':case ' ':case 0xA0:case 0x1680:case 0x2028:case 0x2029:case 0x202F:case 0x205F:case 0x3000:case 0xFEFF:return true;
            default:return c>=0x2000&&c<=0x200A;}
    }
    static String trim(String value){
        int start=0,end=value.length();
        while(start<end&&space(value.charAt(start)))start++;
        while(end>start&&space(value.charAt(end-1)))end--;
        return value.substring(start,end);
    }

    static String outputFormat(Object value){
        // 이전 버전 자료처럼 형식 값이 없거나 알 수 없으면 기존 회의록 형식으로 읽는다.
        return value instanceof String&&OUTPUT_FORMATS.contains(value)?(String)value:"meeting";
    }

    // 앱은 프로젝트를 3개까지만 쓴다. 이전 버전과 파일을 주고받도록 교환 파일은 9칸을 유지하고 4~9번은 비워 둔다.
    static final int MAX_PROJECTS=3;
    static List<Project> limit(List<Project> projects) throws IOException {
        List<Project> kept=new ArrayList<>();List<String> extra=new ArrayList<>();
        for(Project p:projects){if(p.slot<=MAX_PROJECTS)kept.add(p);else if(!p.empty())extra.add(p.slot+"번");}
        if(!extra.isEmpty())throw invalid("프로젝트는 "+MAX_PROJECTS+"개까지만 쓸 수 있습니다. 이 파일에는 "+String.join(", ",extra)+" 프로젝트가 있어 불러오지 않았습니다.");
        return kept;
    }

    static byte[] write(List<Project> projects) throws IOException {
        if(projects.size()!=SLOTS)throw new IOException("프로젝트 설정 9개를 모두 읽지 못했습니다.");
        List<Project> sorted=new ArrayList<>(projects);sorted.sort(Comparator.comparingInt(p->p.slot));
        StringBuilder out=new StringBuilder("{\n  \"format\": ").append(quote(FORMAT)).append(",\n  \"version\": ").append(VERSION).append(",\n  \"projects\": [");
        for(int i=0;i<SLOTS;i++){
            Project p=sorted.get(i);if(p.slot!=i+1)throw new IOException("프로젝트 번호가 올바르지 않습니다.");
            // 이름이 빈 슬롯은 빈 설정으로 내보내 다른 기기에서 같은 빈 슬롯으로 읽히게 한다.
            boolean empty=p.empty();String name=empty?"":p.name,title=empty?"":p.title,context=empty?"":p.context,format=empty?"meeting":outputFormat(p.outputFormat);
            checkLengths(p.slot,name,title,context);
            out.append(i==0?"\n":",\n").append("    {\"slot\": ").append(p.slot).append(", \"name\": ").append(quote(name)).append(", \"title\": ").append(quote(title))
                .append(", \"context\": ").append(quote(context)).append(", \"outputFormat\": ").append(quote(format)).append('}');
        }
        byte[] bytes=out.append("\n  ]\n}\n").toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAX_BYTES)throw new IOException("설정 파일이 128KiB를 넘어 내보낼 수 없습니다.");
        return bytes;
    }

    static List<Project> read(byte[] bytes) throws IOException {
        if(bytes.length>MAX_BYTES)throw new IOException("설정 파일이 128KiB보다 큽니다.");
        String text;
        try{text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
        catch(CharacterCodingException ex){throw new IOException("UTF-8 설정 파일이 아닙니다.");}
        if(text.startsWith("﻿"))text=text.substring(1);
        Object parsed=new Parser(text).document();
        if(!(parsed instanceof Map))throw invalid("최상위 값이 객체가 아닙니다.");
        Map<?,?> root=(Map<?,?>)parsed;
        for(Object key:root.keySet())if(!ROOT_KEYS.contains(key))throw invalid("허용하지 않는 항목("+key+")이 있습니다.");
        if(!FORMAT.equals(root.get("format")))throw invalid("VoiceNote 프로젝트 설정 파일이 아닙니다.");
        if(integer(root.get("version"))!=VERSION)throw invalid("지원하지 않는 설정 파일 버전입니다.");
        if(!(root.get("projects") instanceof List))throw invalid("projects 목록이 없습니다.");
        List<?> entries=(List<?>)root.get("projects");
        if(entries.size()!=SLOTS)throw invalid("프로젝트가 정확히 9개여야 합니다.");
        Project[] bySlot=new Project[SLOTS];
        for(Object entry:entries){
            if(!(entry instanceof Map))throw invalid("프로젝트 항목 형식이 올바르지 않습니다.");
            Map<?,?> item=(Map<?,?>)entry;
            for(Object key:item.keySet())if(!PROJECT_KEYS.contains(key))throw invalid("프로젝트에 허용하지 않는 항목("+key+")이 있습니다.");
            for(String key:PROJECT_KEYS)if(!item.containsKey(key))throw invalid("프로젝트에 "+key+" 항목이 없습니다.");
            int slot=integer(item.get("slot"));
            if(slot<1||slot>SLOTS)throw invalid("프로젝트 번호는 1부터 9까지여야 합니다.");
            if(bySlot[slot-1]!=null)throw invalid(slot+"번 프로젝트가 중복되었습니다.");
            String name=text(item,"name",slot),title=text(item,"title",slot),context=text(item,"context",slot),format=text(item,"outputFormat",slot);
            checkLengths(slot,name,title,context);
            if(!OUTPUT_FORMATS.contains(format))throw invalid(slot+"번 프로젝트의 출력 형식은 meeting, summary, tasks 중 하나여야 합니다.");
            // 데스크톱과 같은 규칙이다. 이름이 없으면 공백뿐인 제목·설명만 허용해 빈 회의록 슬롯으로 읽고, 이름이 있으면 이름·제목의 앞뒤 공백만 지우고 설명은 원문 그대로 둔다.
            if(trim(name).isEmpty()){
                if(!trim(title).isEmpty()||!trim(context).isEmpty()||!"meeting".equals(format))throw invalid(slot+"번 프로젝트는 이름이 비어 있으므로 제목과 설명이 비어 있고 출력 형식이 meeting이어야 합니다.");
                bySlot[slot-1]=new Project(slot,"","","","meeting");
            }else bySlot[slot-1]=new Project(slot,trim(name),trim(title),context,format);
        }
        return Arrays.asList(bySlot);
    }

    static void checkLengths(int slot,String name,String title,String context) throws IOException {
        if(name.length()>NAME_MAX)throw invalid(slot+"번 프로젝트 이름은 100자 이내여야 합니다.");
        if(title.length()>TITLE_MAX)throw invalid(slot+"번 프로젝트 기본 회의명은 160자 이내여야 합니다.");
        if(context.length()>CONTEXT_MAX)throw invalid(slot+"번 프로젝트 설명은 4,000자 이내여야 합니다.");
    }
    static String text(Map<?,?> item,String key,int slot) throws IOException {Object value=item.get(key);if(!(value instanceof String))throw invalid(slot+"번 프로젝트의 "+key+" 값은 문자열이어야 합니다.");return (String)value;}
    static int integer(Object value) throws IOException {
        // JSON은 1과 1.0을 구분하지 않으므로 소수부가 없는 숫자만 정수로 인정한다.
        if(value instanceof Double){double d=(Double)value;if(d==Math.rint(d)&&Math.abs(d)<1e6)return (int)d;}
        throw invalid("번호와 버전은 정수여야 합니다.");
    }
    static IOException invalid(String reason){return new IOException("설정 파일을 불러올 수 없습니다. "+reason+" 기존 설정은 바뀌지 않았습니다.");}

    static String quote(String value){
        StringBuilder out=new StringBuilder("\"");
        for(int i=0;i<value.length();i++){char c=value.charAt(i);
            switch(c){case '"':out.append("\\\"");break;case '\\':out.append("\\\\");break;case '\n':out.append("\\n");break;case '\r':out.append("\\r");break;case '\t':out.append("\\t");break;case '\b':out.append("\\b");break;case '\f':out.append("\\f");break;
                default:
                    // 짝 없는 서로게이트는 UTF-8로 바꾸면 '?'가 되므로 데스크톱 JSON.stringify처럼 \\uXXXX로 남긴다.
                    boolean lone=Character.isHighSurrogate(c)?i+1>=value.length()||!Character.isLowSurrogate(value.charAt(i+1)):Character.isLowSurrogate(c)&&(i==0||!Character.isHighSurrogate(value.charAt(i-1)));
                    if(c<0x20||c==0x2028||c==0x2029||lone)out.append(String.format(Locale.ROOT,"\\u%04x",(int)c));else out.append(c);}
        }
        return out.append('"').toString();
    }

    static final class Parser {
        // JSON.parse와 같은 엄격한 문법만 받는다. 주석·작은따옴표·뒤따르는 쉼표·중복 키는 거절한다.
        final String s; int at,depth;
        Parser(String s){this.s=s;}
        Object document() throws IOException {Object value=value();space();if(at!=s.length())throw syntax();return value;}
        IOException syntax(){return invalid("JSON 문법이 올바르지 않습니다.");}
        void space(){while(at<s.length()){char c=s.charAt(at);if(c==' '||c=='\t'||c=='\n'||c=='\r')at++;else break;}}
        Object value() throws IOException {
            space();if(at>=s.length())throw syntax();char c=s.charAt(at);
            if(c=='{')return object();if(c=='[')return array();if(c=='"')return string();
            if(s.startsWith("true",at)){at+=4;return Boolean.TRUE;}if(s.startsWith("false",at)){at+=5;return Boolean.FALSE;}if(s.startsWith("null",at)){at+=4;return null;}
            return number();
        }
        Map<String,Object> object() throws IOException {
            if(++depth>32)throw syntax();at++;Map<String,Object> map=new LinkedHashMap<>();space();
            if(at<s.length()&&s.charAt(at)=='}'){at++;depth--;return map;}
            while(true){space();if(at>=s.length()||s.charAt(at)!='"')throw syntax();String key=string();space();
                if(at>=s.length()||s.charAt(at)!=':')throw syntax();at++;
                if(map.containsKey(key))throw invalid("같은 항목("+key+")이 두 번 들어 있습니다.");
                map.put(key,value());space();if(at>=s.length())throw syntax();char c=s.charAt(at++);if(c=='}')break;if(c!=',')throw syntax();}
            depth--;return map;
        }
        List<Object> array() throws IOException {
            if(++depth>32)throw syntax();at++;List<Object> list=new ArrayList<>();space();
            if(at<s.length()&&s.charAt(at)==']'){at++;depth--;return list;}
            while(true){list.add(value());space();if(at>=s.length())throw syntax();char c=s.charAt(at++);if(c==']')break;if(c!=',')throw syntax();}
            depth--;return list;
        }
        String string() throws IOException {
            at++;StringBuilder out=new StringBuilder();
            while(true){if(at>=s.length())throw syntax();char c=s.charAt(at++);
                if(c=='"')return out.toString();if(c<0x20)throw syntax();
                if(c!='\\'){out.append(c);continue;}
                if(at>=s.length())throw syntax();char e=s.charAt(at++);
                switch(e){case '"':case '\\':case '/':out.append(e);break;case 'b':out.append('\b');break;case 'f':out.append('\f');break;case 'n':out.append('\n');break;case 'r':out.append('\r');break;case 't':out.append('\t');break;
                    case 'u':if(at+4>s.length()||!s.substring(at,at+4).matches("[0-9A-Fa-f]{4}"))throw syntax();out.append((char)Integer.parseInt(s.substring(at,at+4),16));at+=4;break;
                    default:throw syntax();}
            }
        }
        Double number() throws IOException {
            int start=at;if(peek('-'))at++;
            if(peek('0'))at++;else if(digits()==0)throw syntax();
            if(peek('.')){at++;if(digits()==0)throw syntax();}
            if(peek('e')||peek('E')){at++;if(peek('+')||peek('-'))at++;if(digits()==0)throw syntax();}
            try{return Double.valueOf(s.substring(start,at));}catch(NumberFormatException ex){throw syntax();}
        }
        boolean peek(char c){return at<s.length()&&s.charAt(at)==c;}
        int digits(){int from=at;while(at<s.length()&&s.charAt(at)>='0'&&s.charAt(at)<='9')at++;return at-from;}
    }
}
