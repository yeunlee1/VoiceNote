// 프로젝트 설정과 녹음 및 회의 기록을 휴대폰 내부 파일로 보관한다.
package kr.local.meetingjournal;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;

final class Store {
    final Context context;
    final File root;
    Store(Context context) { this.context=context.getApplicationContext(); root=new File(context.getFilesDir(),"회의자료"); root.mkdirs(); }
    static String read(File file) throws Exception { try(InputStream in=new FileInputStream(file)){return read(in);} }
    static String read(InputStream in) throws Exception { ByteArrayOutputStream out=new ByteArrayOutputStream(); byte[] b=new byte[8192]; for(int n;(n=in.read(b))!=-1;)out.write(b,0,n);return out.toString("UTF-8"); }
    static void write(File file,String text) throws Exception {
        file.getParentFile().mkdirs(); AtomicFile atomic=new AtomicFile(file); FileOutputStream out=atomic.startWrite();
        try {out.write(text.getBytes(StandardCharsets.UTF_8));atomic.finishWrite(out);} catch(Exception ex){atomic.failWrite(out);throw ex;}
    }
    JSONObject asset(String name) throws Exception {try(InputStream in=context.getAssets().open(name)){return new JSONObject(read(in));}}
    // 이전 버전의 4~9번 폴더는 지우지 않고 남겨 두되 읽거나 쓰지 않는다.
    File project(int slot) {if(slot<1||slot>SettingsExchange.MAX_PROJECTS)throw new IllegalArgumentException("프로젝트 번호 오류"); File dir=new File(root,String.format(Locale.ROOT,"프로젝트-%02d",slot));dir.mkdirs();return dir;}
    JSONObject preset(int slot) throws Exception {
        File file=new File(project(slot),"설정.json");
        JSONObject value=file.exists()?new JSONObject(read(file)):slot==1?asset("preset.json"):new JSONObject().put("name","").put("title","").put("context","");
        return value.put("slot",slot).put("outputFormat",SettingsExchange.outputFormat(value.opt("outputFormat")));
    }
    JSONArray presets() throws Exception {JSONArray all=new JSONArray();for(int i=1;i<=SettingsExchange.MAX_PROJECTS;i++)all.put(preset(i));return all;}
    void deletePreset(int slot) throws Exception {
        // 회의 기록이 하나라도 있으면 기록이 이름 없는 프로젝트에 남지 않도록 삭제를 막는다.
        File file=new File(project(slot),"설정.json");
        if(SettingsExchange.trim(preset(slot).optString("name")).isEmpty())throw new IOException("저장된 프로젝트가 아닙니다.");
        File[] meetings=project(slot).listFiles(File::isDirectory);
        if(meetings!=null&&meetings.length>0)throw new IOException("회의 기록이 있는 프로젝트는 삭제할 수 없습니다.");
        if(slot==1)write(file,settings(1,"","","","meeting"));else new AtomicFile(file).delete();
    }
    void savePreset(int slot,JSONObject value) throws Exception {
        if(SettingsExchange.trim(value.optString("name")).isEmpty())throw new IOException("프로젝트 이름을 입력하세요.");
        if(value.optString("name").length()>100||value.optString("context").length()>4000)throw new IOException("프로젝트 이름은 100자, 설명은 4,000자 이내로 입력하세요.");
        if(value.optString("title").length()>160)throw new IOException("기본 회의명은 160자 이내로 입력하세요.");
        String format=value.optString("outputFormat","meeting");if(!SettingsExchange.OUTPUT_FORMATS.contains(format))throw new IOException("출력 형식을 다시 선택하세요.");
        write(new File(project(slot),"설정.json"),settings(slot,SettingsExchange.trim(value.getString("name")),SettingsExchange.trim(value.optString("title")),value.optString("context"),format));
    }
    static String settings(int slot,String name,String title,String context,String format) throws Exception {return new JSONObject().put("slot",slot).put("name",name).put("title",title).put("context",context).put("outputFormat",format).toString(2);}
    byte[] exportSettings() throws Exception {
        // 화면에서 고친 값이 아니라 저장된 설정 파일(없으면 빈 기본값)만 내보낸다.
        List<SettingsExchange.Project> all=new ArrayList<>();
        for(int i=1;i<=SettingsExchange.SLOTS;i++){
            if(i>SettingsExchange.MAX_PROJECTS){all.add(new SettingsExchange.Project(i,"","","","meeting"));continue;}
            JSONObject p=preset(i);all.add(new SettingsExchange.Project(i,p.optString("name"),p.optString("title"),p.optString("context"),p.optString("outputFormat")));
        }
        return SettingsExchange.write(all);
    }
    static volatile int failImportAfter=-1;
    synchronized void importSettings(List<SettingsExchange.Project> projects) throws Exception {
        // 3개 제한을 통과한 설정을 한꺼번에 바꾼다. 중간에 실패하면 이미 바꾼 슬롯을 원래 내용으로 되돌린다. 회의 기록과 녹음은 건드리지 않는다.
        int count=SettingsExchange.MAX_PROJECTS;
        if(projects.size()!=count)throw new IOException("프로젝트 설정 "+count+"개가 필요합니다.");
        String[] before=new String[count];
        for(int i=0;i<count;i++){File file=new File(project(i+1),"설정.json");before[i]=file.exists()?read(file):null;}
        int written=0;
        try{
            for(SettingsExchange.Project p:projects){
                if(failImportAfter>=0&&written>=failImportAfter)throw new IOException("시험용 쓰기 실패");
                write(new File(project(p.slot),"설정.json"),settings(p.slot,p.name,p.title,p.context,p.outputFormat));written++;
            }
        }catch(Exception ex){
            for(int i=0;i<written;i++){int slot=projects.get(i).slot;File file=new File(project(slot),"설정.json");
                try{if(before[slot-1]!=null)write(file,before[slot-1]);else new AtomicFile(file).delete();}catch(Exception ignored){}}
            throw new IOException("설정을 저장하지 못해 이전 설정으로 되돌렸습니다. 회의 기록은 그대로입니다.");
        }
    }
    File directory(int slot,String id) {if(!id.matches("[0-9a-f-]{36}"))throw new IllegalArgumentException("회의 번호 오류");return new File(project(slot),id);}
    JSONObject load(int slot,String id) throws Exception {return new JSONObject(read(new File(directory(slot,id),"회의정보.json")));}
    void save(JSONObject record) throws Exception {write(new File(directory(record.getInt("slot"),record.getString("id")),"회의정보.json"),record.toString(2));}
    synchronized JSONObject create(int slot,JSONObject input) throws Exception {
        String date=input.optString("date"); if(!date.matches("\\d{4}-\\d{2}-\\d{2}"))throw new IOException("회의 날짜를 확인하세요.");
        // 출력 형식은 회의마다 고른 값을 쓰고, 고르지 않았으면 프로젝트 값을 쓴다. 내 형식은 당시 정의를 기록에 남긴다.
        String format=input.optString("outputFormat",preset(slot).getString("outputFormat"));
        if(!SettingsExchange.OUTPUT_FORMATS.contains(format)&&!"custom".equals(format))throw new IOException("출력 형식을 다시 선택하세요.");
        JSONObject custom="custom".equals(format)?new JSONObject(CustomFormat.parse(String.valueOf(input.opt("customFormat"))).json()):null;
        int sequence=1; JSONArray all=history(slot);for(int i=0;i<all.length();i++){JSONObject item=all.getJSONObject(i);if(date.equals(item.optString("date")))sequence=Math.max(sequence,item.optInt("dailySequence")+1);}
        JSONObject record=new JSONObject().put("id",UUID.randomUUID().toString()).put("slot",slot).put("date",date).put("dailySequence",sequence).put("title",input.optString("title","회의"))
            .put("projectName",preset(slot).getString("name")).put("context",preset(slot).optString("context")).put("outputFormat",format).put("participants",input.optString("participants")).put("notes",notes(input))
            .put("createdAt",System.currentTimeMillis()).put("state","recording").put("audio",new JSONArray());
        if(custom!=null)record.put("customFormat",custom);
        save(record);lastFormat(slot,format);return record;
    }
    JSONArray history(int slot) throws Exception {
        List<JSONObject> records=new ArrayList<>();File[] dirs=project(slot).listFiles(File::isDirectory);
        if(dirs!=null)for(File dir:dirs){File file=new File(dir,"회의정보.json");if(file.exists())records.add(new JSONObject(read(file)));}
        records.sort((a,b)->Long.compare(b.optLong("createdAt"),a.optLong("createdAt")));JSONArray result=new JSONArray();for(JSONObject record:records)result.put(record);return result;
    }
    static String notes(JSONObject input) throws IOException {
        String value=input.optString("notes","");if(value.length()>4000)throw new IOException("회의별 상세 내용은 4,000자 이내로 입력하세요.");return value;
    }
    static volatile String sessionKey;
    String key() throws Exception {
        // 사용자가 등록한 개인 키만 돌려준다. 설치본의 공용 기본 키는 defaultKey()로 따로 읽어 체험 횟수 규칙을 거친다.
        if(sessionKey!=null)return sessionKey;
        String custom=context.getSharedPreferences("connection",0).getString("key",null);return custom==null?"":custom;
    }
    String keySource() throws Exception {
        if(sessionKey!=null)return "session";
        if(context.getSharedPreferences("connection",0).getString("key",null)!=null)return "saved";
        return "none";
    }
    static volatile String testDefaultKey;
    String defaultKey(){
        // 빌드가 패키징할 때만 넣는 assets/default.key({"apiKey":"..."})를 읽는다. 값은 화면이나 기록에 내보내지 않는다.
        if(testDefaultKey!=null)return testDefaultKey;
        try(InputStream in=context.getAssets().open("default.key")){String value=new JSONObject(read(in)).optString("apiKey").trim();return value.length()<=500?value:"";}catch(Exception absent){return "";}
    }
    static TrialAccess trial;
    TrialAccess trial(){
        // 화면과 녹음 서비스가 같은 프로세스의 예약 하나를 함께 쓰도록 앱 전체에 하나만 둔다.
        synchronized(Store.class){if(trial==null)trial=new TrialAccess(new File(context.getFilesDir(),"trial-access.json"));return trial;}
    }
    TrialAccess.Status access() throws Exception {return trial().status(!key().isEmpty(),!defaultKey().isEmpty());}
    void requireAccess() throws Exception {
        TrialAccess.Status status=access();
        if(status.mustRegister)throw new IOException(status.accessMode.equals("exhausted")?TrialAccess.EXHAUSTED_MESSAGE:"AI 설정에서 API 키를 먼저 등록하세요.");
    }
    void key(String value,boolean persist) throws Exception {
        value=value.trim();if(!value.startsWith("sk-")||value.length()<20)throw new IOException("API 키 형식을 확인하세요. sk-로 시작하는 키 전체를 붙여 넣으세요.");
        if(persist){sessionKey=null;context.getSharedPreferences("connection",0).edit().putString("key",value).commit();}
        else{context.getSharedPreferences("connection",0).edit().remove("key").commit();sessionKey=value;}
    }
    void removeKey(){sessionKey=null;context.getSharedPreferences("connection",0).edit().remove("key").commit();}
    String summaryModel(){return context.getSharedPreferences("connection",0).getString("summaryModel",null);}
    void summaryModel(String id){context.getSharedPreferences("connection",0).edit().putString("summaryModel",id).commit();}
    JSONObject draft(int slot) throws Exception {File file=new File(project(slot),"작성중.json");return file.exists()?new JSONObject(read(file)):new JSONObject();}
    void draft(int slot,JSONObject value) throws Exception {
        notes(value);JSONObject saved=new JSONObject();for(String name:new String[]{"title","date","participants","notes"})saved.put(name,value.optString(name));
        write(new File(project(slot),"작성중.json"),saved.toString(2));
    }
    void clearDraft(int slot){new File(project(slot),"작성중.json").delete();}
    void finish(JSONObject record,JSONObject minutes) throws Exception {
        String title=minutes.optString("suggestedTitle",record.optString("title"));record.put("title",title).put("state","complete").put("message","회의록 저장 완료");
        File dir=directory(record.getInt("slot"),record.getString("id"));long version=System.currentTimeMillis();
        write(new File(dir,"요약-"+version+".json"),minutes.toString(2));write(new File(dir,"요약.json"),minutes.toString(2));
        write(new File(dir,"회의록.txt"),format(record,minutes));save(record);
    }
    static String meetingFormat(JSONObject record){
        if("custom".equals(record.optString("outputFormat"))&&record.optJSONObject("customFormat")!=null){try{custom(record);return "custom";}catch(Exception ignored){}}
        return SettingsExchange.outputFormat(record.opt("outputFormat"));
    }
    static CustomFormat custom(JSONObject record) throws Exception {return CustomFormat.parse(record.getJSONObject("customFormat").toString());}
    static String documentLabel(JSONObject record) throws Exception {return "custom".equals(meetingFormat(record))?custom(record).name:label(meetingFormat(record));}
    File customFile(){return new File(root,"내형식.json");}
    JSONObject customFormat() throws Exception {
        File file=customFile();if(!file.exists())return null;
        try{return new JSONObject(CustomFormat.parse(read(file)).json());}catch(IOException ex){throw new IOException("내 형식 파일을 읽지 못했습니다. 기존 파일은 보존합니다.");}
    }
    JSONObject saveCustomFormat(JSONObject value) throws Exception {CustomFormat format=CustomFormat.parse(value.toString());write(customFile(),format.json());return new JSONObject(format.json());}
    void deleteCustomFormat(){new AtomicFile(customFile()).delete();}
    String lastFormat(int slot){return context.getSharedPreferences("formats",0).getString("slot-"+slot,null);}
    void lastFormat(int slot,String format){context.getSharedPreferences("formats",0).edit().putString("slot-"+slot,format).commit();}
    static String label(String format){return "summary".equals(format)?"핵심 요약":"tasks".equals(format)?"업무 정리":"회의록";}
    static String format(JSONObject record,JSONObject minutes) throws Exception {
        String kind=meetingFormat(record);
        StringBuilder out=new StringBuilder(record.optString("title")).append("\n\n").append(record.optString("date")).append(" · ").append(record.optInt("dailySequence")).append("차 회의");
        if("custom".equals(kind)){
            // 내 형식은 고른 항목만 고른 순서와 이름으로 쓰고, 내용이 없는 항목은 없음으로 남긴다.
            CustomFormat custom=custom(record);out.append(" · ").append(custom.name);
            for(CustomFormat.Section section:custom.sections){
                out.append("\n\n").append(section.title).append("\n");
                if("overview".equals(section.key)){out.append(minutes.getString("overview")).append("\n");continue;}
                if("topics".equals(section.key)){if(minutes.getJSONArray("topics").length()==0)out.append("없음\n");else topics(out,minutes);continue;}
                if("actions".equals(section.key)){if(minutes.getJSONArray("actions").length()==0)out.append("- 없음\n");else actions(out,minutes,true);continue;}
                JSONArray items=minutes.getJSONArray(section.key);if(items.length()==0)out.append("- 없음\n");
                for(int i=0;i<items.length();i++)out.append("- ").append(items.getString(i)).append("\n");
            }
            return out.toString();
        }
        if("summary".equals(kind)){
            out.append(" · 핵심 요약\n\n핵심 요약\n").append(minutes.getString("overview")).append("\n\n주요 내용\n");topics(out,minutes);
            out.append("\n합의된 방향\n");append(out,minutes.getJSONArray("decisions"));out.append("\n다음 할 일\n");actions(out,minutes,false);
            out.append("\n미확정 사항\n");append(out,minutes.getJSONArray("openQuestions"));return out.toString();
        }
        if("tasks".equals(kind)){
            // 업무 정리는 담당과 기한이 없으면 지어내지 않고 미정으로 보여 준다.
            out.append(" · 업무 정리\n\n업무 요약\n").append(minutes.getString("overview")).append("\n\n할 일\n");actions(out,minutes,true);
            out.append("\n확인 필요\n");append(out,minutes.getJSONArray("openQuestions"));out.append("\n결정 사항\n");append(out,minutes.getJSONArray("decisions"));
            out.append("\n관련 논의\n");topics(out,minutes);return out.toString();
        }
        out.append("\n\n핵심 요약\n").append(minutes.getString("overview")).append("\n\n상세 회의 내용\n\n합의된 방향\n");
        append(out,minutes.getJSONArray("decisions"));topics(out,minutes);
        out.append("\n다음 할 일\n");actions(out,minutes,false);
        out.append("\n미확정 사항\n");append(out,minutes.getJSONArray("openQuestions"));return out.toString();
    }
    static void topics(StringBuilder out,JSONObject minutes) throws Exception {JSONArray topics=minutes.getJSONArray("topics");for(int i=0;i<topics.length();i++){JSONObject topic=topics.getJSONObject(i);out.append("\n").append(topic.getString("title")).append("\n");append(out,topic.getJSONArray("points"));}}
    static void actions(StringBuilder out,JSONObject minutes,boolean undecided) throws Exception {
        JSONArray actions=minutes.getJSONArray("actions");
        for(int i=0;i<actions.length();i++){JSONObject a=actions.getJSONObject(i);out.append("- ").append(a.getString("task"));
            if(!a.isNull("owner")&&!a.optString("owner").isEmpty())out.append(" · 담당 ").append(a.optString("owner"));else if(undecided)out.append(" · 담당 미정");
            if(!a.isNull("due")&&!a.optString("due").isEmpty())out.append(" · 기한 ").append(a.optString("due"));else if(undecided)out.append(" · 기한 미정");
            out.append("\n");}
    }
    static void append(StringBuilder out,JSONArray entries) throws Exception {for(int i=0;i<entries.length();i++)out.append(entries.getString(i)).append("\n\n");}
}
