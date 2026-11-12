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
        return new JSONObject().put("summaryModel",model).put("defaultOutputFormat",defaultOutputFormat()).put("storage",Copies.storage(context)).put("myName",myName());
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
    // 설정의 내 이름이다. 지난 회의에서 같은 이름의 사람을 나로 미리 고르는 데만 쓰고 설정 내보내기 파일에는 담지 않는다.
    String myName(){return context.getSharedPreferences("connection",0).getString("myName","");}
    JSONObject saveSettings(JSONObject value)throws Exception{
        synchronized(Store.class){
            if(value.length()==1&&value.has("myName")){
                Object name=value.opt("myName");
                if(!(name instanceof String)||((String)name).length()>Todos.MAX_FIELD)throw new IOException("내 이름은 200자 이하로 적어 주세요.");
                android.content.SharedPreferences prefs=context.getSharedPreferences("connection",0);String before=prefs.getString("myName",null);
                if(!prefs.edit().putString("myName",JsonText.trim((String)name)).commit()){
                    android.content.SharedPreferences.Editor previous=prefs.edit();if(before==null)previous.remove("myName");else previous.putString("myName",before);previous.commit();
                    // commit이 false여도 메모리에는 새 이름이 먼저 들어가 있다. 이전 이름으로 되돌려 목록의 수와 화면이 같은 사람을 기준으로 남게 한다.
                    throw new IOException("내 이름을 저장하지 못했습니다.");
                }
                return settings();
            }
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
        List<JSONObject> records=new ArrayList<>();int skipped=0;String myName=myName();
        for(String location:LOCATIONS){
            File[] dirs=locationDirectory(location).listFiles(File::isDirectory);if(dirs==null)continue;
            for(File dir:dirs){File file=new File(dir,"회의정보.json");if(!file.exists())continue;
                try{JSONObject record=load(location,dir.getName());String resultId=latestResultId(location,record);
                    if(resultId!=null){record.put("resultId",resultId);JSONObject result=result(location,record.getString("id"),resultId);
                        record.put("title",result.optString("title")).put("outputFormat",meetingFormat(result)).put("refined",!result.optString("feedback").isEmpty());
                        JSONObject review=loadReview(location,record.getString("id"),resultId);if(review!=null&&!review.isNull("stars"))record.put("stars",review.getInt("stars"));
                        // 최신 결과에서 내가 아직 안 끝낸 일의 수다. 내가 누구인지 모르거나 0이면 붙이지 않고, 세다가 오류가 나도 그 줄은 목록에 남긴다.
                        if(result.optJSONObject("minutes")!=null)try{int open=Todos.mineOpen(result.optString("participants"),effectiveItems(location,record.getString("id"),result),loadMe(location,record.getString("id")),myName);if(open>0)record.put("mineOpen",open);}catch(Exception ignored){}}
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
        if(stars==null&&JsonText.trim(comment).isEmpty())throw new IOException("별점이나 의견을 입력하세요.");
        JSONObject target=result(location,id,resultId);if(!target.has("minutes"))throw new IOException("정리된 결과에만 평가를 남길 수 있습니다.");
        String selected=target.getString("resultId");java.text.SimpleDateFormat date=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);date.setTimeZone(TimeZone.getTimeZone("UTC"));
        JSONObject review=new JSONObject().put("version",1).put("stars",stars==null?JSONObject.NULL:stars).put("comment",JsonText.trim(comment)).put("savedAt",date.format(new Date()));
        write(new File(directory(location,id),"평가-"+selected+".json"),review.toString(2));return review;
    }
    // 할 일 수정본도 평가처럼 결과마다 따로 둔다. 파일이 없거나 읽지 못하면 null이고 AI 결과를 그대로 쓴다.
    File todoFile(String location,String id,String resultId)throws Exception {return new File(directory(location,id),"할일-"+checkedResultId(resultId)+".json");}
    JSONObject loadTodos(String location,String id,String resultId)throws Exception {
        File file=todoFile(location,id,resultId);if(!file.exists())return null;
        // 수정본은 AI 결과와 항목 수가 같아야 한다. 다르면 쓸 수 없는 수정본으로 본다.
        try{JSONObject saved=new JSONObject(read(file));if(saved.optInt("version")!=1)return null;JSONObject checked=checkedTodos(new JSONObject().put("finalized",saved.get("finalized")).put("items",saved.get("items")),result(location,id,resultId).getJSONObject("minutes").getJSONArray("actions"));return checked.put("savedAt",saved.opt("savedAt"));}
        catch(Exception ex){return null;}
    }
    boolean todosUnreadable(String location,String id,String resultId)throws Exception {return todoFile(location,id,resultId).exists()&&loadTodos(location,id,resultId)==null;}
    private static IOException invalidTodos(){return new IOException("할 일 내용을 확인하세요.");}
    private static Object todoField(Object value)throws IOException {
        if(value==null||value==JSONObject.NULL)return JSONObject.NULL;if(!(value instanceof String))throw invalidTodos();
        String text=JsonText.trim((String)value);if(text.length()>Todos.MAX_FIELD)throw invalidTodos();return text.isEmpty()?JSONObject.NULL:text;
    }
    static JSONObject checkedTodos(JSONObject data,JSONArray actions)throws IOException,JSONException {
        int count=actions.length();
        for(Iterator<String> keys=data.keys();keys.hasNext();){String key=keys.next();if(!key.equals("finalized")&&!key.equals("items"))throw invalidTodos();}
        JSONArray items=data.optJSONArray("items");if(!(data.opt("finalized") instanceof Boolean)||items==null||items.length()!=count)throw invalidTodos();
        JSONArray cleaned=new JSONArray();
        for(int i=0;i<items.length();i++){
            JSONObject item=items.optJSONObject(i);if(item==null)throw invalidTodos();
            for(Iterator<String> keys=item.keys();keys.hasNext();){String key=keys.next();if(!key.equals("task")&&!key.equals("owner")&&!key.equals("due")&&!key.equals("done"))throw invalidTodos();}
            if(!(item.opt("task") instanceof String)||!(item.opt("done") instanceof Boolean))throw invalidTodos();
            // AI 결과에 원래 빈 문장이 있으면 그 줄 때문에 나머지 저장이 막히지 않게 둔다. 사람이 문장을 지우는 것은 막는다.
            String task=JsonText.trim(item.getString("task"));boolean blankFromAi=JsonText.trim(actions.getJSONObject(i).optString("task")).isEmpty();
            if((task.isEmpty()&&!blankFromAi)||task.length()>Todos.MAX_TASK)throw invalidTodos();
            cleaned.put(new JSONObject().put("task",task).put("owner",todoField(item.opt("owner"))).put("due",todoField(item.opt("due"))).put("done",item.getBoolean("done")));
        }
        return new JSONObject().put("version",1).put("finalized",data.getBoolean("finalized")).put("items",cleaned);
    }
    private static List<Todos.Item> todoItems(JSONArray values)throws JSONException {
        List<Todos.Item> list=new ArrayList<>();
        for(int i=0;i<values.length();i++){JSONObject item=values.getJSONObject(i);list.add(new Todos.Item(item.getString("task"),item.isNull("owner")?null:item.getString("owner"),item.isNull("due")?null:item.getString("due"),item.optBoolean("done")));}
        return list;
    }
    private static JSONObject todoJson(Todos.Item item,boolean withDone)throws JSONException {
        JSONObject value=new JSONObject().put("task",item.task).put("owner",item.owner==null?JSONObject.NULL:item.owner).put("due",item.due==null?JSONObject.NULL:item.due);return withDone?value.put("done",item.done):value;
    }
    private void writeTodos(String location,String id,String resultId,JSONObject checked)throws Exception {
        File file=todoFile(location,id,resultId);
        // 읽지 못한 수정본을 새 내용으로 덮지 않고 이름을 바꿔 남겨 둔다.
        if(file.exists()&&loadTodos(location,id,resultId)==null)writeBytes(new File(directory(location,id),"할일-"+checkedResultId(resultId)+"-읽기실패-"+System.currentTimeMillis()+".json"),bytes(file));
        java.text.SimpleDateFormat date=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);date.setTimeZone(TimeZone.getTimeZone("UTC"));
        write(file,checked.put("savedAt",date.format(new Date())).toString(2));
    }
    // 할 일 수정본이 결과와 맞으면 수정본을, 아니면 AI 결과를 쓴다(화면의 Todos.effective와 같다).
    List<Todos.Item> effectiveItems(String location,String id,JSONObject result)throws Exception {
        JSONArray actions=result.getJSONObject("minutes").getJSONArray("actions");
        JSONObject edits=result.has("resultId")?loadTodos(location,id,result.getString("resultId")):null;
        return todoItems(edits!=null&&edits.getJSONArray("items").length()==actions.length()?edits.getJSONArray("items"):actions);
    }
    // 이 회의에서 고른 나는 결과가 아니라 회의 폴더의 나.json에 둔다. 의견을 반영해 새 결과가 생겨도 다시 묻지 않는다.
    File meFile(String location,String id){return new File(directory(location,id),"나.json");}
    String loadMe(String location,String id){
        // 파일이 없거나 읽지 못하면 고른 적이 없는 것으로 본다. 읽지 못한 파일은 지우지 않는다.
        // 버전은 숫자 1만 받는다. optInt처럼 1.5나 글자 "1"을 1로 바꿔 읽지 않아 Windows와 같은 파일을 같게 판정한다.
        try{File file=meFile(location,id);if(!file.exists())return null;JSONObject saved=new JSONObject(read(file));Object name=saved.opt("name"),version=saved.opt("version");
            return version instanceof Number&&((Number)version).doubleValue()==1&&name instanceof String&&!JsonText.trim((String)name).isEmpty()&&((String)name).length()<=Todos.MAX_FIELD?(String)name:null;}
        catch(Exception ex){return null;}
    }
    static final String ME_REJECTED="이 회의의 참석자나 담당자 이름 가운데서 골라 주세요.";
    String saveMe(String location,String id,String resultId,String name)throws Exception {
        // 이 회의에서 나를 고르거나(이름) 고른 것을 지운다(null). 보고 있는 결과의 후보에 있는 이름만 받아 후보의 표기로 저장한다.
        synchronized(Store.class){
            JSONObject target=analyzedResult(location,id,resultId);File file=meFile(location,id);
            if(name==null){new AtomicFile(file).delete();if(file.exists())throw new IOException("고른 나를 지우지 못했습니다.");return null;}
            if(name.length()>Todos.MAX_FIELD)throw new IOException(ME_REJECTED);
            String found=null;for(String candidate:Todos.candidates(target.optString("participants"),effectiveItems(location,id,target)))if(Todos.sameName(candidate,name)){found=candidate;break;}
            if(found==null)throw new IOException(ME_REJECTED);
            java.text.SimpleDateFormat date=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT);date.setTimeZone(TimeZone.getTimeZone("UTC"));
            write(file,new JSONObject().put("version",1).put("name",found).put("savedAt",date.format(new Date())).toString(2));
            return found;
        }
    }
    private JSONObject analyzedResult(String location,String id,String resultId)throws Exception {
        JSONObject target=result(location,id,resultId);if(target.optJSONObject("minutes")==null||!target.has("resultId"))throw new IOException("정리된 결과에서만 할 일을 고칠 수 있습니다.");return target;
    }
    JSONObject saveTodos(String location,String id,String resultId,JSONObject data)throws Exception {
        synchronized(Store.class){
            JSONObject target=analyzedResult(location,id,resultId);JSONObject checked=checkedTodos(data,target.getJSONObject("minutes").getJSONArray("actions"));
            writeTodos(location,id,target.getString("resultId"),checked);return checked;
        }
    }
    // 복사·공유·고른 폴더 사본에는 사람이 고친 할 일을 합친 회의록을 쓴다. 보관된 AI 결과는 그대로 둔다.
    JSONObject appliedMinutes(String location,String id,JSONObject record)throws Exception {
        JSONObject minutes=record.getJSONObject("minutes");if(!record.has("resultId"))return minutes;
        JSONObject edits=loadTodos(location,id,record.getString("resultId"));JSONArray actions=minutes.getJSONArray("actions");
        if(edits==null||edits.getJSONArray("items").length()!=actions.length())return minutes;
        List<Todos.Item> items=todoItems(edits.getJSONArray("items"));JSONArray merged=new JSONArray();
        for(int index:Todos.outputOrder(edits.getBoolean("finalized"),items,todoItems(actions)))merged.put(todoJson(items.get(index),false));
        return new JSONObject(minutes.toString()).put("actions",merged);
    }
    private void carryTodos(String location,String id,String previousId,JSONObject minutes,String resultId)throws Exception {
        JSONObject edits=loadTodos(location,id,previousId);if(edits==null)return;
        JSONObject before=result(location,id,previousId).optJSONObject("minutes");if(before==null)return;
        Todos.Carried carried=Todos.carryOver(todoItems(before.getJSONArray("actions")),edits.getBoolean("finalized"),todoItems(edits.getJSONArray("items")),todoItems(minutes.getJSONArray("actions")));if(carried==null)return;
        JSONArray items=new JSONArray();for(Todos.Item item:carried.items)items.put(todoJson(item,true));
        writeTodos(location,id,resultId,checkedTodos(new JSONObject().put("finalized",carried.finalized).put("items",items),minutes.getJSONArray("actions")));
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
        if(status.mustRegister)throw new IOException(status.accessMode.equals("exhausted")?TrialAccess.EXHAUSTED_MESSAGE:"설정의 AI 연결에서 API 키를 먼저 등록하세요.");
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
            // 의견 반영은 보던 결과에서, 그 밖에는 가장 최근 결과에서 사람이 고친 할 일을 잇는다.
            String previousResult=record.has("resultId")&&!record.isNull("resultId")?record.getString("resultId"):null;
            if(previousResult==null)try{previousResult=latestResultId(location,load(location,id));}catch(Exception ignored){}
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
            write(new File(dir,"요약.json"),minutes.toString(2));write(new File(dir,"회의록.txt"),MeetingDocument.text(next,minutes));
            // 결과는 이미 저장됐다. 사람이 고친 할 일을 잇지 못해도 새 결과 저장을 실패로 돌리지 않는다.
            if(previousResult!=null)try{carryTodos(location,id,previousResult,minutes,next.getString("resultId"));}catch(Exception ignored){}
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
    static String format(JSONObject record,JSONObject minutes)throws Exception{return MeetingDocument.text(record,minutes);}

}
