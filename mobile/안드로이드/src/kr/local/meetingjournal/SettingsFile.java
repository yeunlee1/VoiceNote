// 설정 파일 2판을 Android 없이 읽고 검증한다. 내보낼 때는 기기 밖에서 쓸 수 없는 저장 위치를 뺀다.
package kr.local.meetingjournal;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
final class SettingsFile {
    static final String FORMAT="voicenote-settings",LEGACY_MESSAGE="이전 버전의 프로젝트 설정 파일입니다. 프로젝트 기능이 없어져 불러올 수 없습니다.";
    static final String JSON_ERROR="JSON 형식이 아닌 파일입니다. VoiceNote에서 내보낸 설정 파일인지 확인하세요.";
    static final int VERSION=2,MAX_BYTES=128*1024;
    static final List<String> OUTPUT_FORMATS=Collections.unmodifiableList(Arrays.asList("meeting","summary","tasks","custom"));
    static final List<String> ROOT_KEYS=Arrays.asList("format","version","summaryModel","defaultOutputFormat","customFormat","storage");
    static final List<String> STORAGE_KINDS=Arrays.asList("audio","transcript","summary");
    static final class Value {
        final String summaryModel,defaultOutputFormat;final CustomFormat customFormat;final boolean hasStorage;
        Value(String model,String format,CustomFormat custom){this(model,format,custom,false);}
        Value(String model,String format,CustomFormat custom,boolean storage){summaryModel=model;defaultOutputFormat=format;customFormat=custom;hasStorage=storage;}
        String json(){return "{\"format\":"+JsonText.quote(FORMAT)+",\"version\":2,\"summaryModel\":"+JsonText.quote(summaryModel)
            +",\"defaultOutputFormat\":"+JsonText.quote(defaultOutputFormat)+",\"customFormat\":"+(customFormat==null?"null":customFormat.json())+"}";}
    }
    // 옛 결과의 기본 형식을 읽을 때 쓴다. 내 형식 정의는 Store가 따로 확인한 뒤 custom으로 올린다.
    static String outputFormat(Object value){return value instanceof String&&OUTPUT_FORMATS.contains(value)&&!"custom".equals(value)?(String)value:"meeting";}
    static String extra(Map<?,?> value,List<String> allowed){for(String key:JsonText.keys(value))if(!allowed.contains(key))return key;return null;}
    static String shown(String key){return key.length()>40?key.substring(0,40):key;}
    static void model(Object value)throws IOException{
        if(!(value instanceof String)||((String)value).isEmpty()||((String)value).length()>100)throw new IOException("요약 모델 항목을 확인하세요.");
    }
    static void storage(Object value)throws IOException{
        if(!(value instanceof Map))throw new IOException("저장 위치 항목을 확인하세요.");
        Map<?,?> map=(Map<?,?>)value;String extra=extra(map,STORAGE_KINDS);
        if(extra!=null)throw new IOException("저장 위치에 알 수 없는 항목("+shown(extra)+")이 있습니다.");
        for(String kind:STORAGE_KINDS){
            Object field=map.get(kind);if(!(field instanceof String))throw new IOException("저장 위치 항목을 확인하세요.");
            if(((String)field).length()>1000)throw new IOException("저장 위치 경로는 1,000자 이하여야 합니다.");
        }
    }
    static Value read(byte[] bytes)throws IOException{
        if(bytes.length>MAX_BYTES)throw new IOException("설정 파일이 128KiB를 넘었습니다.");
        String text;try{text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
        catch(CharacterCodingException ex){throw new IOException("UTF-8로 저장된 설정 파일이 아닙니다. VoiceNote에서 내보낸 파일인지 확인하세요.");}
        if(text.startsWith("\uFEFF"))text=text.substring(1);
        Object parsed;try{parsed=new JsonText.Parser(text).document();}catch(IOException ex){throw new IOException(JSON_ERROR);}
        if(parsed instanceof Map&&"voicenote-project-settings".equals(((Map<?,?>)parsed).get("format")))throw new IOException(LEGACY_MESSAGE);
        if(!(parsed instanceof Map)||!FORMAT.equals(((Map<?,?>)parsed).get("format")))throw new IOException("VoiceNote 설정 파일이 아닙니다.");
        Map<?,?> map=(Map<?,?>)parsed;String extra=extra(map,ROOT_KEYS);
        if(extra!=null)throw new IOException("설정 파일에 알 수 없는 항목("+shown(extra)+")이 있습니다.");
        Object number=map.get("version");
        if(!(number instanceof Double)||!Double.isFinite((Double)number)||(Double)number<1||(Double)number!=Math.floor((Double)number))throw new IOException("설정 파일 버전을 확인할 수 없습니다.");
        double version=(Double)number;
        if(version>VERSION)throw new IOException("이 VoiceNote보다 새 버전("+JsonText.numberText(version)+")의 설정 파일입니다. 프로그램을 업데이트한 뒤 불러오세요.");
        if(version!=VERSION)throw new IOException("설정 파일 버전을 확인할 수 없습니다.");
        model(map.get("summaryModel"));Object format=map.get("defaultOutputFormat");
        if(!(format instanceof String)||!OUTPUT_FORMATS.contains(format))throw new IOException("기본 출력 형식을 확인하세요.");
        if(!map.containsKey("customFormat"))throw new IOException("내 형식 항목이 없습니다.");
        Object custom=map.get("customFormat");CustomFormat checked=custom==null?null:CustomFormat.validate(custom);
        if(map.containsKey("storage"))storage(map.get("storage"));
        return new Value((String)map.get("summaryModel"),(String)format,checked,map.containsKey("storage"));
    }
    static byte[] write(Value value)throws IOException{
        model(value.summaryModel);if(!OUTPUT_FORMATS.contains(value.defaultOutputFormat))throw new IOException("기본 출력 형식을 확인하세요.");
        byte[] bytes=value.json().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAX_BYTES)throw new IOException("설정 파일이 128KiB를 넘어 내보내지 않았습니다. 내 형식의 추가 지시를 줄여 주세요.");
        return bytes;
    }
}
