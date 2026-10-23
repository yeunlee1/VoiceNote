// 보관함별 녹음과 결과 버전 및 설정을 휴대폰 내부 파일에 보관한다.
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
        writeBytes(file,text.getBytes(StandardCharsets.UTF_8));
    }
    static byte[] bytes(File file)throws IOException{try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];for(int n;(n=in.read(b))!=-1;)out.write(b,0,n);return out.toByteArray();}}
    static void writeBytes(File file,byte[] bytes)throws IOException{
        file.getParentFile().mkdirs(); AtomicFile atomic=new AtomicFile(file); FileOutputStream out=atomic.startWrite();
        try {out.write(bytes);atomic.finishWrite(out);} catch(Exception ex){atomic.failWrite(out);throw ex;}
    }
    JSONObject asset(String name) throws Exception {try(InputStream in=context.getAssets().open(name)){return new JSONObject(read(in));}}
    JSONObject settings()throws Exception{
        String model=summaryModel();if(AiModels.find(model)==null)model=AiModels.DEFAULT_MODEL;
        return new JSONObject().put("summaryModel",model).put("defaultOutputFormat",defaultOutputFormat());
    }
    byte[] exportSettings()throws Exception{
        JSONObject current=settings(),custom=customFormat();
        return SettingsFile.write(new SettingsFile.Value(current.getString("summaryModel"),current.getString("defaultOutputFormat"),custom==null?null:CustomFormat.parse(custom.toString())));
    }
    static volatile int failImportAfter=-1;
    JSONObject settingsPreview(SettingsFile.Value value)throws Exception{
        boolean model=AiModels.find(value.summaryModel)!=null;
        JSONObject preview=new JSONObject().put("summaryModel",new JSONObject().put("value",value.summaryModel).put("apply",model))
            .put("defaultOutputFormat",new JSONObject().put("value",value.defaultOutputFormat).put("apply",true))
            .put("customFormat",new JSONObject().put("name",value.customFormat==null?JSONObject.NULL:value.customFormat.name).put("apply",true))
            .put("storage",JSONObject.NULL).put("storageIgnored",value.hasStorage);
        if(!model)preview.getJSONObject("summaryModel").put("reason","이 앱의 요약 모델 목록에 없어 적용하지 않습니다.");
        return preview;
    }
    JSONObject importSettings(SettingsFile.Value value)throws Exception{
        synchronized(Store.class){
            // 저장 전 바이트와 두 설정 칸을 보관한다. 실패 주입은 실제 사용자 자료와 무관한 기기 시험에서만 쓴다.
            android.content.SharedPreferences prefs=context.getSharedPreferences("connection",0);
            String oldModel=prefs.getString("summaryModel",null),oldFormat=prefs.getString("defaultOutputFormat",null);
            File file=customFile();byte[] before=file.exists()?bytes(file):null;
            boolean known=AiModels.find(value.summaryModel)!=null;JSONArray skipped=new JSONArray();
            if(!known)skipped.put("요약 모델: 이 앱의 요약 모델 목록에 없어 적용하지 않습니다.");
            if(value.hasStorage)skipped.put("저장 위치: Android에서는 적용하지 않습니다.");
            try{
                if(failImportAfter==0)throw new IOException("시험용 설정 저장 실패");
                android.content.SharedPreferences.Editor next=prefs.edit().putString("defaultOutputFormat",value.defaultOutputFormat);
                if(known)next.putString("summaryModel",value.summaryModel);
                if(!next.commit())throw new IOException("설정을 저장하지 못했습니다.");
                if(failImportAfter==1)throw new IOException("시험용 내 형식 저장 실패");
                if(value.customFormat==null)deleteCustomFormat();else saveCustomFormat(new JSONObject(value.customFormat.json()));
                if(failImportAfter==2)throw new IOException("시험용 저장 완료 전 실패");
                return new JSONObject().put("settings",settings()).put("customFormat",customFormat()==null?JSONObject.NULL:customFormat()).put("skipped",skipped);
            }catch(Exception ex){
                boolean restored=true;
                try{android.content.SharedPreferences.Editor previous=prefs.edit();
                    if(oldModel==null)previous.remove("summaryModel");else previous.putString("summaryModel",oldModel);
                    if(oldFormat==null)previous.remove("defaultOutputFormat");else previous.putString("defaultOutputFormat",oldFormat);
                    if(!previous.commit())restored=false;
                }catch(Exception restore){restored=false;}
                try{if(before==null)deleteCustomFormat();else writeBytes(file,before);}catch(Exception restore){restored=false;}
                throw new IOException(restored?"설정을 바꾸지 못해 이전 값으로 되돌렸습니다. 회의자료 폴더의 쓰기 권한과 디스크 공간을 확인하세요.":"설정을 바꾸지 못했고 이전 값으로 되돌리지도 못했습니다. 설정에서 값을 다시 확인하세요.",ex);
            }
        }
    }
    JSONObject saveSettings(JSONObject value)throws Exception{
        synchronized(Store.class){
            if(value.length()!=1||!value.has("defaultOutputFormat"))throw new IOException("기본 출력 형식을 확인하세요.");
            Object format=value.opt("defaultOutputFormat");if(!(format instanceof String)||!SettingsFile.OUTPUT_FORMATS.contains(format))throw new IOException("기본 출력 형식을 확인하세요.");
            android.content.SharedPreferences prefs=context.getSharedPreferences("connection",0);String before=prefs.getString("defaultOutputFormat",null);
            if(!prefs.edit().putString("defaultOutputFormat",(String)format).commit()){
                android.content.SharedPreferences.Editor previous=prefs.edit();if(before==null)previous.remove("defaultOutputFormat");else previous.putString("defaultOutputFormat",before);previous.commit();
                throw new IOException("기본 출력 형식을 저장하지 못했습니다.");
            }
            return settings();
        }
    }
    static final String[] LOCATIONS={"main","p1","p2","p3"};
    File locationDirectory(String location) {
        for(int i=0;i<LOCATIONS.length;i++)if(LOCATIONS[i].equals(location))return new File(root,i==0?"회의기록":String.format(Locale.ROOT,"프로젝트-%02d",i));
        throw new IllegalArgumentException("보관함 이름을 확인하세요.");
    }
    static String location(JSONObject record)throws JSONException {
        if(record.has("location"))return record.getString("location");
        int slot=record.getInt("slot");if(slot<1||slot>3)throw new IllegalArgumentException("보관함 번호를 확인하세요.");return "p"+slot;
    }
    File directory(String location,String id) {
        if(id==null||!id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))throw new IllegalArgumentException("회의 번호를 확인하세요.");
        return new File(locationDirectory(location),id);
    }
    JSONObject load(String location,String id)throws Exception {
        JSONObject record=new JSONObject(read(new File(directory(location,id),"회의정보.json")));
        if(!id.equals(record.optString("id"))||!location.equals(location(record)))throw new IOException("보관함과 회의 기록이 일치하지 않습니다.");
        return record.put("location",location);
    }
    void save(JSONObject record)throws Exception {
        synchronized(Store.class){
            String location=location(record),id=record.getString("id");File dir=directory(location,id);
            preserveLegacy(location,id);
            // 옛 최신 결과는 상태·사용량 갱신보다 먼저 별도 파일로 보존한다.
            record.put("location",location);write(new File(dir,"회의정보.json"),record.toString(2));
        }
    }
    JSONObject create(JSONObject input)throws Exception {
        synchronized(Store.class){
            if(input.has("location")&&!"main".equals(input.optString("location")))throw new IOException("새 녹음은 기본 보관함에만 만들 수 있습니다.");
            String date=input.optString("date");if(!date.matches("\\d{4}-\\d{2}-\\d{2}"))throw new IOException("회의 날짜를 확인하세요.");
            String format=input.optString("outputFormat",defaultOutputFormat());
            if(!SettingsFile.OUTPUT_FORMATS.contains(format)&&!"custom".equals(format))throw new IOException("출력 형식을 다시 선택하세요.");
            JSONObject custom=null;
            if("custom".equals(format)){
                if(input.has("customFormat"))custom=new JSONObject(CustomFormat.parse(String.valueOf(input.opt("customFormat"))).json());
                else if(input.has("outputFormat"))throw new IOException("내 형식 내용을 확인하세요.");
                else{custom=customFormat();if(custom==null)format="meeting";}
            }
            int sequence=1;File[] dirs=locationDirectory("main").listFiles(File::isDirectory);
            if(dirs!=null)for(File dir:dirs){try{JSONObject item=load("main",dir.getName());if(date.equals(item.optString("date")))sequence=Math.max(sequence,item.optInt("dailySequence")+1);}catch(Exception ignored){}}
            JSONObject record=new JSONObject().put("id",UUID.randomUUID().toString()).put("location","main").put("date",date).put("dailySequence",sequence)
                .put("title",input.optString("title","")).put("outputFormat",format).put("participants",input.optString("participants")).put("notes",notes(input))
                .put("createdAt",System.currentTimeMillis()).put("state","recording").put("audio",new JSONArray());
            if(custom!=null)record.put("customFormat",custom);save(record);return record;
        }
    }
    String defaultOutputFormat(){String value=context.getSharedPreferences("connection",0).getString("defaultOutputFormat","meeting");return SettingsFile.OUTPUT_FORMATS.contains(value)?value:"meeting";}
    JSONObject history()throws Exception {
        List<JSONObject> records=new ArrayList<>();int skipped=0;
        for(String location:LOCATIONS){
            File[] dirs=locationDirectory(location).listFiles(File::isDirectory);if(dirs==null)continue;
            for(File dir:dirs){File file=new File(dir,"회의정보.json");if(!file.exists())continue;
                try{JSONObject record=load(location,dir.getName());String resultId=latestResultId(location,record);
                    if(resultId!=null){record.put("resultId",resultId);JSONObject result=result(location,record.getString("id"),resultId);
                        record.put("title",result.optString("title")).put("outputFormat",meetingFormat(result)).put("refined",!result.optString("feedback").isEmpty());
                        JSONObject review=loadReview(location,record.getString("id"),resultId);if(review!=null&&!review.isNull("stars"))record.put("stars",review.getInt("stars"));}
                    records.add(record);
                }catch(Exception ex){skipped++;}
            }
        }
        records.sort((a,b)->{int order=b.optString("date").compareTo(a.optString("date"));return order!=0?order:Long.compare(b.optLong("createdAt"),a.optLong("createdAt"));});
        JSONArray all=new JSONArray();for(JSONObject record:records)all.put(record);return new JSONObject().put("meetings",all).put("skipped",skipped);
    }
    static String checkedResultId(String id) {
        if(id==null||!id.matches("(?:[0-9]{1,19}|legacy)"))throw new IllegalArgumentException("결과 번호를 확인하세요.");return id;
    }
    String legacyId(File dir) {
        String latest=null;File[] files=dir.listFiles();if(files!=null)for(File file:files){
            String name=file.getName();if(file.isFile()&&name.matches("요약-[0-9]{1,18}\\.json")){
                String value=name.substring(3,name.length()-5);if(latest==null||Long.parseLong(value)>Long.parseLong(latest))latest=value;}
        }return latest==null?"legacy":latest;
    }
    String latestResultId(String location,JSONObject record)throws Exception {
        String id=record.getString("id");File dir=directory(location,id);
        if(record.has("resultId")&&!record.isNull("resultId"))return checkedResultId(record.getString("resultId"));
        return new File(dir,"요약.json").exists()?legacyId(dir):null;
    }
    JSONObject legacyResult(String location,String id)throws Exception {
        JSONObject record=load(location,id);File dir=directory(location,id),summary=new File(dir,"요약.json");
        if(!summary.exists())return null;
        return record.put("resultId",legacyId(dir)).put("savedAt",summary.lastModified()).put("minutes",new JSONObject(read(summary)));
    }
    void preserveLegacy(String location,String id)throws Exception {
        File dir=directory(location,id),metadata=new File(dir,"회의정보.json");if(!metadata.exists())return;
        JSONObject before=new JSONObject(read(metadata));if(before.has("location")||(before.has("resultId")&&!before.isNull("resultId")))return;
        JSONObject legacy=legacyResult(location,id);if(legacy==null)return;File file=new File(dir,"결과-"+legacy.getString("resultId")+".json");
        if(!file.exists())write(file,legacy.toString(2));
    }
    JSONObject result(String location,String id,String resultId)throws Exception {
        JSONObject meeting=load(location,id);String selected=resultId==null?latestResultId(location,meeting):checkedResultId(resultId);
        if(selected==null)return meeting;
        File dir=directory(location,id),file=new File(dir,"결과-"+selected+".json");JSONObject result;
        if(file.exists())result=new JSONObject(read(file));
        else{result=legacyResult(location,id);if(result==null||!selected.equals(result.optString("resultId")))throw new IOException("저장된 결과를 찾을 수 없습니다.");}
        if(!location.equals(location(result))||!id.equals(result.optString("id"))||!selected.equals(result.optString("resultId")))throw new IOException("보관함과 결과 기록이 일치하지 않습니다.");
        return result.put("location",location);
    }
    JSONArray results(String location,String id)throws Exception {
        JSONObject meeting=load(location,id);File dir=directory(location,id);List<JSONObject> all=new ArrayList<>();
        Set<String> ids=new HashSet<>();File[] files=dir.listFiles();
        if(files!=null)for(File file:files){String name=file.getName();if(!file.isFile()||!name.matches("결과-(?:[0-9]{1,19}|legacy)\\.json"))continue;
            String resultId=name.substring(3,name.length()-5);try{JSONObject record=result(location,id,resultId);all.add(version(location,id,record));ids.add(resultId);}catch(Exception ignored){}}
        String latest=latestResultId(location,meeting);if(latest!=null&&!ids.contains(latest))all.add(version(location,id,result(location,id,latest)));
        all.sort((a,b)->Long.compare(a.optLong("savedAt"),b.optLong("savedAt")));JSONArray values=new JSONArray();for(JSONObject value:all)values.put(value);return values;
    }
    JSONObject version(String location,String id,JSONObject record)throws Exception {
        String resultId=record.getString("resultId");JSONObject value=new JSONObject().put("id",resultId).put("savedAt",record.optLong("savedAt"))
            .put("outputFormat",meetingFormat(record)).put("refined",!record.optString("feedback").isEmpty());JSONObject review=loadReview(location,id,resultId);
        if(review!=null&&!review.isNull("stars"))value.put("stars",review.getInt("stars"));return value;
    }
    JSONObject loadReview(String location,String id,String resultId)throws Exception {
        File file=new File(directory(location,id),"평가-"+checkedResultId(resultId)+".json");return file.exists()?new JSONObject(read(file)):null;
    }
    JSONObject saveReview(String location,String id,String resultId,Integer stars,String comment)throws Exception {
        if(stars!=null&&(stars<1||stars>5))throw new IOException("별점은 1~5 중에서 골라 주세요.");
        if(comment==null)comment="";if(comment.length()>1000)throw new IOException("의견은 1,000자 이하로 입력하세요.");
        if(stars==null&&comment.trim().isEmpty())throw new IOException("별점이나 의견을 입력하세요.");
        JSONObject target=result(location,id,resultId);if(!target.has("minutes"))throw new IOException("정리된 결과에만 평가를 남길 수 있습니다.");
        String selected=target.getString("resultId");java.text.SimpleDateFormat date=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);date.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSONObject review=new JSONObject().put("version",1).put("stars",stars==null?JSONObject.NULL:stars).put("comment",comment).put("savedAt",date.format(new Date()));
        write(new File(directory(location,id),"평가-"+selected+".json"),review.toString(2));return review;
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
    JSONObject draft()throws Exception {
        synchronized(Store.class){
            android.content.SharedPreferences prefs=context.getSharedPreferences("connection",0);File file=new File(locationDirectory("main"),"작성중.json");
            if(!prefs.getBoolean("draftMigrated",false)){
                if(!file.exists()){
                    List<File> candidates=new ArrayList<>();for(int i=1;i<=3;i++){File old=new File(locationDirectory("p"+i),"작성중.json");if(old.exists())candidates.add(old);}
                    candidates.sort((a,b)->Long.compare(b.lastModified(),a.lastModified()));
                    for(File old:candidates){
                        JSONObject value;try{value=draftValue(new JSONObject(read(old)));}catch(JSONException|IOException ignored){continue;}
                        write(file,value.toString(2));break;
                    }
                }
                if(!prefs.edit().putBoolean("draftMigrated",true).commit())throw new IOException("작성 중 메모 이관 상태를 저장하지 못했습니다.");
            }
            try{return file.exists()?draftValue(new JSONObject(read(file))):new JSONObject();}
            catch(JSONException|IOException ex){
                // 손상된 새 초안은 따로 보존하고 빈 메모로 이어 간다. 보존 쓰기마저 실패하면 원본을 남긴다.
                try{File backup=new File(locationDirectory("main"),"작성중-읽기실패-"+System.currentTimeMillis()+"-"+UUID.randomUUID()+".json");writeBytes(backup,bytes(file));new AtomicFile(file).delete();}catch(IOException ignored){}
                return new JSONObject();
            }
        }
    }
    JSONObject draftValue(JSONObject input)throws Exception {
        notes(input);JSONObject value=new JSONObject();for(String name:new String[]{"title","date","participants","notes"}){
            Object field=input.opt(name);if(field!=null&&field!=JSONObject.NULL&&!(field instanceof String))throw new IOException("작성 중 메모 형식을 확인하세요.");value.put(name,input.optString(name,""));}
        return value;
    }
    void saveDraft(JSONObject value)throws Exception {synchronized(Store.class){draft();write(new File(locationDirectory("main"),"작성중.json"),draftValue(value).toString(2));}}
    void clearDraft()throws Exception {synchronized(Store.class){draft();new AtomicFile(new File(locationDirectory("main"),"작성중.json")).delete();}}
    void finish(JSONObject record,JSONObject minutes,String feedback)throws Exception {
        synchronized(Store.class){
            if(feedback!=null&&feedback.length()>1000)throw new IOException("의견은 1,000자 이하로 입력하세요.");
            String location=location(record),id=record.getString("id");File dir=directory(location,id);preserveLegacy(location,id);
            // 최신 포인터를 발행하기 전에는 입력·쓰기 실패가 호출자의 현재 결과를 바꾸지 않는다.
            JSONObject next=new JSONObject(record.toString());next.remove("minutes");
            String title=minutes.optString("suggestedTitle","").trim();if(title.isEmpty())title=next.optString("title","").trim();if(title.isEmpty())title="회의";
            long version=System.currentTimeMillis();while(new File(dir,"결과-"+version+".json").exists())version++;
            next.put("location",location).put("resultId",Long.toString(version)).put("title",title).put("state","complete").put("message","회의록 저장 완료").put("savedAt",version);next.remove("slot");
            if(feedback!=null&&!feedback.trim().isEmpty())next.put("feedback",feedback);else next.remove("feedback");
            JSONObject snapshot=new JSONObject(next.toString()).put("minutes",new JSONObject(minutes.toString()));
            write(new File(dir,"결과-"+version+".json"),snapshot.toString(2));
            write(new File(dir,"회의정보.json"),next.toString(2));
            // 실제 결과와 최신 포인터를 먼저 확정한다. 부속 파일 쓰기가 실패해도 새 요약을 가짜 옛 결과로 읽지 않는다.
            List<String> oldKeys=new ArrayList<>();for(Iterator<String> keys=record.keys();keys.hasNext();)oldKeys.add(keys.next());for(String key:oldKeys)record.remove(key);
            for(Iterator<String> keys=next.keys();keys.hasNext();){String key=keys.next();record.put(key,next.get(key));}
            write(new File(dir,"요약.json"),minutes.toString(2));write(new File(dir,"회의록.txt"),format(next,minutes));
        }
    }
    static String meetingFormat(JSONObject record){
        if("custom".equals(record.optString("outputFormat"))&&record.optJSONObject("customFormat")!=null){try{custom(record);return "custom";}catch(Exception ignored){}}
        return SettingsFile.outputFormat(record.opt("outputFormat"));
    }
    static CustomFormat custom(JSONObject record) throws Exception {return CustomFormat.parse(record.getJSONObject("customFormat").toString());}
    static String documentLabel(JSONObject record) throws Exception {return "custom".equals(meetingFormat(record))?custom(record).name:label(meetingFormat(record));}
    File customFile(){return new File(root,"내형식.json");}
    JSONObject customFormat() throws Exception {
        File file=customFile();if(!file.exists())return null;
        try{return new JSONObject(CustomFormat.parse(read(file)).json());}catch(IOException ex){throw new IOException("내 형식 파일을 읽지 못했습니다. 기존 파일은 보존합니다.");}
    }
    JSONObject saveCustomFormat(JSONObject value) throws Exception {CustomFormat format=CustomFormat.parse(value.toString());write(customFile(),format.json());return new JSONObject(format.json());}
    void deleteCustomFormat()throws IOException{File file=customFile();new AtomicFile(file).delete();if(file.exists())throw new IOException("내 형식을 지우지 못했습니다.");}
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
