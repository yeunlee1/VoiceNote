// 엄격한 JSON 문법과 문자열 공백·인용 규칙을 공유한다. JVM과 Android에서 같은 값을 만든다.
package kr.local.meetingjournal;
import java.io.IOException;
import java.util.*;
final class JsonText {
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

    static long index(String key){
        try{long n=Long.parseLong(key);return n>=0&&n<4294967295L&&Long.toString(n).equals(key)?n:-1;}catch(NumberFormatException ex){return -1;}
    }
    static List<String> keys(Map<?,?> value){
        // Object.keys는 정수 모양의 키를 먼저 숫자 순으로 돌려준다. 오류에 표시하는 첫 키도 맞춘다.
        List<String> keys=new ArrayList<>();for(Object key:value.keySet())keys.add(String.valueOf(key));
        keys.sort((a,b)->{long x=index(a),y=index(b);return x>=0?(y>=0?Long.compare(x,y):-1):(y>=0?1:0);});return keys;
    }
    static String numberText(double value){
        java.math.BigDecimal decimal=java.math.BigDecimal.valueOf(value).stripTrailingZeros();
        if(Math.abs(value)>=1e-6&&Math.abs(value)<1e21)return decimal.toPlainString();
        return decimal.toString().replace("E","e");
    }
    static final class Parser {
        // 중첩은 스택으로 읽어 JVM 호출 스택에 기대지 않는다. 중복 키는 JSON.parse와 같이 마지막 값을 쓴다.
        final String s;int at;
        static final class Frame {
            final Object value;int state;String key;
            Frame(Object value){this.value=value;}
        }
        Parser(String s){this.s=s;}
        IOException syntax(){return new IOException("JSON 문법이 올바르지 않습니다.");}
        void space(){while(at<s.length()){char c=s.charAt(at);if(c==' '||c=='\t'||c=='\n'||c=='\r')at++;else break;}}
        @SuppressWarnings("unchecked") Object document()throws IOException {
            Deque<Frame> stack=new ArrayDeque<>();Object root=value(stack);
            while(!stack.isEmpty()){
                Frame f=stack.peek();space();if(at>=s.length())throw syntax();char c=s.charAt(at);
                if(f.value instanceof Map){
                    Map<String,Object> map=(Map<String,Object>)f.value;
                    if(f.state==0||f.state==1){
                        if(f.state==0&&c=='}'){at++;stack.pop();continue;}
                        if(c!='"')throw syntax();f.key=string();f.state=2;
                    }else if(f.state==2){if(c!=':')throw syntax();at++;f.state=3;
                    }else if(f.state==3){f.state=4;map.put(f.key,value(stack));
                    }else if(c=='}'){at++;stack.pop();
                    }else if(c==','){at++;f.state=1;}else throw syntax();
                }else{
                    List<Object> list=(List<Object>)f.value;
                    if(f.state==0||f.state==1){
                        if(f.state==0&&c==']'){at++;stack.pop();continue;}
                        f.state=2;list.add(value(stack));
                    }else if(c==']'){at++;stack.pop();
                    }else if(c==','){at++;f.state=1;}else throw syntax();
                }
            }
            space();if(at!=s.length())throw syntax();return root;
        }
        Object value(Deque<Frame> stack)throws IOException{
            space();if(at>=s.length())throw syntax();char c=s.charAt(at);
            if(c=='{'||c=='['){at++;Object value=c=='{'?new LinkedHashMap<String,Object>():new ArrayList<Object>();stack.push(new Frame(value));return value;}
            if(c=='"')return string();
            if(s.startsWith("true",at)){at+=4;return Boolean.TRUE;}if(s.startsWith("false",at)){at+=5;return Boolean.FALSE;}if(s.startsWith("null",at)){at+=4;return null;}
            return number();
        }
        String string()throws IOException{
            at++;StringBuilder out=new StringBuilder();
            while(true){if(at>=s.length())throw syntax();char c=s.charAt(at++);
                if(c=='"')return out.toString();if(c<0x20)throw syntax();if(c!='\\'){out.append(c);continue;}
                if(at>=s.length())throw syntax();char e=s.charAt(at++);
                switch(e){case '"':case '\\':case '/':out.append(e);break;case 'b':out.append('\b');break;case 'f':out.append('\f');break;case 'n':out.append('\n');break;case 'r':out.append('\r');break;case 't':out.append('\t');break;
                    case 'u':if(at+4>s.length()||!s.substring(at,at+4).matches("[0-9A-Fa-f]{4}"))throw syntax();out.append((char)Integer.parseInt(s.substring(at,at+4),16));at+=4;break;
                    default:throw syntax();}
            }
        }
        Double number()throws IOException{
            int start=at;if(peek('-'))at++;
            if(peek('0'))at++;else if(digits()==0)throw syntax();
            if(peek('.')){at++;if(digits()==0)throw syntax();}
            if(peek('e')||peek('E')){at++;if(peek('+')||peek('-'))at++;if(digits()==0)throw syntax();}
            try{return Double.valueOf(s.substring(start,at));}catch(NumberFormatException ex){throw syntax();}
        }
        boolean peek(char c){return at<s.length()&&s.charAt(at)==c;}
        int digits(){int start=at;while(at<s.length()&&s.charAt(at)>='0'&&s.charAt(at)<='9')at++;return at-start;}
    }
}
