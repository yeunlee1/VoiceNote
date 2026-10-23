// 가상 안드로이드에서 실제 저장 코드와 모의 AI 응답의 분할 복구를 검증한다.
package kr.local.meetingjournal;
import android.app.Instrumentation;
import android.os.Bundle;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class AndroidChecks extends Instrumentation {
    static final Queue<String> replies=new ArrayDeque<>();
    static final List<String> requests=new ArrayList<>();
    static int code=200,checks;
    static volatile String lastAuth;
    static final List<String> auths=new ArrayList<>();
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    static void expect(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    static JSONObject minutes()throws Exception{return new JSONObject().put("suggestedTitle","표준 문서 구현 준비").put("overview","전체 방향 | 제조지시서를 먼저 구현합니다.\n주요 결정 | 기존 DB를 사용합니다.").put("topics",new JSONArray().put(new JSONObject().put("title","문서 연결").put("points",new JSONArray().put("생산 중 문서를 반복해서 확인하므로 이동을 단순하게 합니다.")))).put("decisions",new JSONArray().put("기존 DB 활용")).put("actions",new JSONArray().put(new JSONObject().put("task","화면 기획").put("owner",JSONObject.NULL).put("due",JSONObject.NULL))).put("openQuestions",new JSONArray().put("탭 방식은 미정"));}
    static String completed()throws Exception{return new JSONObject().put("status","completed").put("output",new JSONArray().put(new JSONObject().put("type","message").put("content",new JSONArray().put(new JSONObject().put("type","output_text").put("text",minutes().toString()))))).toString();}
    static String[] settingsFiles(Store store)throws Exception{String[] all=new String[SettingsExchange.MAX_PROJECTS];for(int i=0;i<SettingsExchange.MAX_PROJECTS;i++){File f=new File(store.project(i+1),"설정.json");all[i]=f.exists()?Store.read(f):null;}return all;}
    static int meetingFiles(File dir){int n=0;File[] items=dir.listFiles();if(items!=null)for(File f:items)n+=f.isDirectory()?count(f):0;return n;}
    static int count(File dir){int n=0;File[] items=dir.listFiles();if(items!=null)for(File f:items)n+=f.isDirectory()?count(f):1;return n;}
    static JSONObject analyzable(Store store,String title)throws Exception{
        // 저장된 전사를 다시 쓰는 회의 기록을 만들어 전사 요청 없이 요약 요청만 보내게 한다.
        JSONObject record=store.create(3,new JSONObject().put("date","2099-01-05").put("title",title));record.getJSONArray("audio").put("원음-001.m4a");store.save(record);
        Store.write(new File(store.directory(3,record.getString("id")),"전사-001.txt"),"체험 검증 전사");return record;
    }
    static String firstSystem(String body)throws Exception{return new JSONObject(body).getJSONArray("input").getJSONObject(0).getString("content");}
    static void settingsFormatAndTrial(Store store)throws Exception{
        // 시험 전 프로젝트 설정 파일과 저장된 키를 보관했다가 끝에 그대로 되돌린다. 회의 자료와 녹음은 지우지 않는다.
        String[] original=settingsFiles(store);android.content.SharedPreferences prefs=store.context.getSharedPreferences("connection",0);String savedKey=prefs.getString("key",null);
        TrialAccess previousTrial=Store.trial;String previousSession=Store.sessionKey;
        try{
            JSONObject fresh=store.asset("preset.json");
            expect(fresh.optString("name").isEmpty()&&fresh.optString("title").isEmpty()&&fresh.optString("context").isEmpty()&&fresh.optString("outputFormat").equals("meeting"),"fresh install preset is empty");
            Store.write(new File(store.project(2),"설정.json"),"{\"slot\":2,\"name\":\"옛 프로젝트\",\"title\":\"회의\",\"context\":\"옛 설명\"}");
            JSONObject old=store.preset(2);
            expect(old.getString("name").equals("옛 프로젝트")&&old.getString("context").equals("옛 설명")&&old.getString("outputFormat").equals("meeting"),"pre-1.1.1 settings kept and read as meeting");
            byte[] exported=store.exportSettings();String exportedText=new String(exported,StandardCharsets.UTF_8);
            expect(SettingsExchange.read(exported).get(1).name.equals("옛 프로젝트")&&!exportedText.contains("sk-")&&!exportedText.contains("apiKey")&&!exportedText.contains("trial"),"export holds saved settings without keys or trial state");
            List<SettingsExchange.Project> incoming=new ArrayList<>();
            for(int i=1;i<=SettingsExchange.MAX_PROJECTS;i++)incoming.add(i==1?new SettingsExchange.Project(1,"가져온 업무","주간 점검","여러 줄\n설명 😀","tasks"):i==3?new SettingsExchange.Project(3,"자동 검증 프로젝트","","테스트","summary"):new SettingsExchange.Project(i,"","","","meeting"));
            String[] before=settingsFiles(store);int meetings=store.history(3).length(),files=meetingFiles(store.project(3));
            Store.failImportAfter=2;
            try{store.importSettings(incoming);throw new AssertionError("import failure must throw");}catch(IOException ex){expect(ex.getMessage().contains("되돌렸"),"failed import reports rollback");}
            Store.failImportAfter=-1;
            expect(Arrays.equals(settingsFiles(store),before),"failed import leaves all settings unchanged");
            store.importSettings(incoming);JSONArray presets=store.presets();
            expect(presets.getJSONObject(0).getString("name").equals("가져온 업무")&&presets.getJSONObject(0).getString("context").equals("여러 줄\n설명 😀")&&presets.getJSONObject(0).getString("outputFormat").equals("tasks")&&presets.getJSONObject(1).getString("name").isEmpty()&&presets.getJSONObject(2).getString("outputFormat").equals("summary"),"import replaces all settings");
            expect(store.history(3).length()==meetings&&meetingFiles(store.project(3))==files,"import keeps meeting records and recordings");
            expect(Arrays.equals(SettingsExchange.write(SettingsExchange.read(store.exportSettings())),store.exportSettings()),"imported settings export again unchanged");
            try{store.deletePreset(2);throw new AssertionError("empty delete");}catch(IOException ex){expect(ex.getMessage().contains("저장된 프로젝트"),"empty project cannot be deleted");}
            store.savePreset(2,new JSONObject().put("name","삭제 시험"));store.deletePreset(2);
            expect(store.preset(2).optString("name").isEmpty()&&!new File(store.project(2),"설정.json").exists(),"project without meetings deleted");
            try{store.project(4);throw new AssertionError("slot 4");}catch(IllegalArgumentException ex){expect(true,"slot 4 and above not used");}

            store.savePreset(3,new JSONObject().put("name","자동 검증 프로젝트").put("context","테스트").put("outputFormat","tasks"));
            try{store.savePreset(3,new JSONObject().put("name","자동 검증 프로젝트").put("outputFormat","minutes"));throw new AssertionError("bad format");}catch(IOException ex){expect(ex.getMessage().contains("출력 형식"),"unknown output format rejected on save");}
            JSONObject tasks=analyzable(store,"형식 검증");expect(tasks.getString("outputFormat").equals("tasks"),"meeting record keeps project output format");
            try{store.deletePreset(3);throw new AssertionError("delete with meetings");}catch(IOException ex){expect(ex.getMessage().contains("회의 기록"),"project with meetings cannot be deleted");}
            int sent=requests.size();replies.add(completed());new Ai(store,message->{}).run(tasks);
            JSONObject tasksRequest=new JSONObject(requests.get(sent));
            expect(firstSystem(requests.get(sent)).equals(store.asset("summary-tasks.json").getJSONArray("input").getJSONObject(0).getString("content"))&&!firstSystem(requests.get(sent)).equals(store.asset("summary-meeting.json").getJSONArray("input").getJSONObject(0).getString("content")),"tasks format sends tasks instructions");
            expect(tasksRequest.getInt("max_output_tokens")==32000&&tasksRequest.getString("model").equals("gpt-6.1-sol")&&tasksRequest.getJSONObject("text").toString().equals(store.asset("summary-meeting.json").getJSONObject("text").toString()),"same model, budget and minutes schema for every format");
            JSONObject user=new JSONObject(tasksRequest.getJSONArray("input").getJSONObject(tasksRequest.getJSONArray("input").length()-1).getString("content"));
            expect(!user.has("outputFormat")&&user.has("transcript"),"user message fields unchanged");
            String tasksText=Store.read(new File(store.directory(3,tasks.getString("id")),"회의록.txt"));
            expect(tasksText.contains("업무 정리")&&tasksText.contains("할 일\n- 화면 기획 · 담당 미정 · 기한 미정"),"tasks document lists undecided owner and due");
            JSONObject loaded=store.load(3,tasks.getString("id"));expect(loaded.getString("outputFormat").equals("tasks")&&loaded.getString("state").equals("complete"),"format kept in saved record");
            sent=requests.size();replies.add(completed());new Ai(store,message->{}).run(loaded);
            expect(firstSystem(requests.get(sent)).equals(firstSystem(requests.get(sent-1))),"reanalysis keeps the record's format");
            // 내 형식: 저장·조회, 회의 기록의 당시 정의, AI 요청의 두 번째 지시, 저장 본문의 항목 순서
            JSONObject savedCustom=store.saveCustomFormat(new JSONObject().put("name"," 주간 보고 ").put("sections",new JSONArray().put(new JSONObject().put("key","actions").put("title","이번 주 할 일")).put(new JSONObject().put("key","overview").put("title","한 줄 요약"))).put("instruction","부서별로 / 묶기"));
            expect(savedCustom.getString("name").equals("주간 보고")&&store.customFormat().toString().equals(savedCustom.toString()),"custom format saved and read");
            try{store.saveCustomFormat(new JSONObject().put("name","").put("sections",new JSONArray()));throw new AssertionError("bad custom");}catch(IOException ex){expect(ex.getMessage().contains("이름"),"invalid custom format rejected");}
            JSONObject customRecord=store.create(3,new JSONObject().put("date","2099-01-06").put("title","내 형식 회의").put("outputFormat","custom").put("customFormat",savedCustom));
            expect(Store.meetingFormat(customRecord).equals("custom")&&customRecord.getJSONObject("customFormat").getString("name").equals("주간 보고")&&"custom".equals(store.lastFormat(3)),"meeting keeps custom definition and remembers format");
            customRecord.getJSONArray("audio").put("원음-001.m4a");store.save(customRecord);Store.write(new File(store.directory(3,customRecord.getString("id")),"전사-001.txt"),"내 형식 전사");
            sent=requests.size();replies.add(completed());new Ai(store,message->{}).run(customRecord);
            JSONArray customInput=new JSONObject(requests.get(sent)).getJSONArray("input");
            expect(customInput.getJSONObject(1).getString("content").equals(Store.custom(customRecord).instruction())&&customInput.getJSONObject(0).getString("content").equals(store.asset("summary-meeting.json").getJSONArray("input").getJSONObject(0).getString("content")),"custom instruction sent right after meeting instructions");
            String customText=Store.read(new File(store.directory(3,customRecord.getString("id")),"회의록.txt"));
            expect(customText.indexOf("이번 주 할 일")>0&&customText.indexOf("이번 주 할 일")<customText.indexOf("한 줄 요약")&&!customText.contains("합의된 방향"),"custom document follows chosen order");
            try{store.create(3,new JSONObject().put("date","2099-01-06").put("outputFormat","custom"));throw new AssertionError("custom without definition");}catch(IOException ex){expect(true,"custom meeting needs definition");}
            store.deleteCustomFormat();expect(store.customFormat()==null,"custom format deleted");
            JSONObject legacy=new JSONObject().put("title","옛 회의").put("date","2026-09-30").put("dailySequence",1);
            expect(Store.format(legacy,minutes()).contains("상세 회의 내용")&&Store.format(new JSONObject(legacy.toString()).put("outputFormat","summary"),minutes()).contains("주요 내용"),"old records keep meeting layout, summary has its layout");

            // 공용 기본 키 체험: 개인 키를 잠시 비우고 시험용 상태 파일과 모의 키로만 확인한다.
            Store.sessionKey=null;prefs.edit().remove("key").commit();
            Store.testDefaultKey="sk-mock-default-000000000000";Store.trial=new TrialAccess(new File(store.context.getCacheDir(),"trial-check-"+UUID.randomUUID()+".json"));
            expect(store.access().accessMode.equals("trial")&&store.access().trialRemaining==3,"default key starts with 3 trial analyses");
            JSONObject first=analyzable(store,"체험 1");sent=requests.size();
            replies.add("{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}");replies.add(completed());replies.add(completed());
            String long1=new String(new char[6000]).replace('\0','나');Store.write(new File(store.directory(3,first.getString("id")),"전사-001.txt"),long1);
            new Ai(store,message->{}).run(first);
            expect(requests.size()-sent==3&&store.access().trialUsed==1,"split requests of one analysis count once");
            expect(auths.get(auths.size()-1).startsWith("Bearer sk-mock-default"),"default key used for trial requests");
            JSONObject failing=analyzable(store,"체험 실패");code=500;replies.add("{}");
            try{new Ai(store,message->{}).run(failing);throw new AssertionError("server error must fail");}catch(IOException ex){expect(ex.getMessage().contains("HTTP 500"),"failed analysis reports error");}
            code=200;expect(store.access().trialUsed==1&&store.access().trialReserved==0,"failed analysis releases without counting");
            for(int i=2;i<=3;i++){replies.add(completed());new Ai(store,message->{}).run(analyzable(store,"체험 "+i));}
            expect(store.access().accessMode.equals("exhausted")&&store.access().mustRegister,"three successful analyses exhaust the trial");
            try{new Ai(store,message->{});throw new AssertionError("exhausted must block");}catch(IOException ex){expect(ex.getMessage().equals("새로운 API키를 등록하세요."),"exhausted analysis shows exact register message");}
            store.trial().unlock();replies.add(completed());new Ai(store,message->{}).run(analyzable(store,"해제 후"));
            expect(store.access().accessMode.equals("unlimited")&&store.access().trialUsed==3,"unlock allows default key without counting");
            Store.sessionKey="sk-mock-personal-00000000000000";replies.add(completed());new Ai(store,message->{}).run(analyzable(store,"개인 키"));
            expect(store.access().accessMode.equals("personal")&&auths.get(auths.size()-1).startsWith("Bearer sk-mock-personal"),"personal key used without trial limits");
        }finally{
            Store.failImportAfter=-1;code=200;Store.testDefaultKey=null;Store.trial=previousTrial;Store.sessionKey=previousSession;
            if(savedKey!=null)prefs.edit().putString("key",savedKey).commit();
            for(int i=0;i<SettingsExchange.MAX_PROJECTS;i++){File f=new File(store.project(i+1),"설정.json");if(original[i]!=null)Store.write(f,original[i]);else new android.util.AtomicFile(f).delete();}
        }
    }
    @Override public void onStart(){Bundle result=new Bundle();try{
        URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){return new HttpURLConnection(url){
            final ByteArrayOutputStream sent=new ByteArrayOutputStream();
            public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
            public void setRequestProperty(String key,String value){if("Authorization".equals(key))lastAuth=value;}
            public OutputStream getOutputStream(){return sent;}
            public int getResponseCode(){return code;}
            public InputStream getInputStream()throws IOException{requests.add(new String(sent.toByteArray(),StandardCharsets.UTF_8));auths.add(lastAuth);String next=replies.poll();if(next==null)throw new IOException("Unexpected network request");return new ByteArrayInputStream(next.getBytes(StandardCharsets.UTF_8));}
            public InputStream getErrorStream(){try{return getInputStream();}catch(IOException ex){throw new RuntimeException(ex);}}
        };}}:null);
        Store store=new Store(getTargetContext());store.savePreset(3,new JSONObject().put("name","자동 검증 프로젝트").put("context","테스트"));
        String previousModel=store.summaryModel();store.summaryModel(null);
        boolean bundledKey=true;try{getTargetContext().getAssets().open("personal.key").close();}catch(FileNotFoundException absent){bundledKey=false;}
        expect(!bundledKey,"installer has no bundled API key");
        boolean defaultKey=true;try{getTargetContext().getAssets().open("default.key").close();}catch(FileNotFoundException absent){defaultKey=false;}
        expect(!defaultKey,"test build has no real default key");
        String savedKey=getTargetContext().getSharedPreferences("connection",0).getString("key",null);
        Store.sessionKey=null;if(savedKey==null)expect(store.key().isEmpty()&&store.keySource().equals("none"),"missing key reads as empty instead of crashing");
        try{store.key("bad",true);throw new AssertionError("bad key must fail");}catch(IOException ex){expect(ex.getMessage().contains("형식"),"bad key reason shown");}
        store.key("sk-mock-only-0000000000000000",false);expect(store.keySource().equals("session")&&store.key().startsWith("sk-mock"),"session key used without persisting");
        expect(getTargetContext().getSharedPreferences("connection",0).getString("key",null)==null,"session key not written to storage");
        store.draft(3,new JSONObject().put("title","초안").put("date","2099-01-02").put("notes","안건 초안"));expect(store.draft(3).getString("notes").equals("안건 초안"),"draft survives reload");store.clearDraft(3);expect(store.draft(3).length()==0,"draft cleared after start");
        try{store.create(3,new JSONObject().put("date","2099-01-01").put("notes",new String(new char[4001]).replace('\0','가')));throw new AssertionError("long notes must fail");}catch(IOException ex){expect(ex.getMessage().contains("4,000"),"notes limit enforced");}
        JSONObject input=new JSONObject().put("date","2099-01-01").put("title","검증 회의").put("notes","1. 탭 구조 결정\n2. 기존 DB 재사용");
        JSONObject record=store.create(3,input),second=store.create(3,input);
        expect(second.getInt("dailySequence")==record.getInt("dailySequence")+1,"same day sequence");
        expect(store.load(3,record.getString("id")).getString("notes").startsWith("1. 탭 구조"),"meeting notes saved and loaded");
        expect(MeetingService.safeMessage(new java.net.UnknownHostException("Unable to resolve host \"api.openai.com\"")).startsWith("인터넷에 연결할 수 없습니다"),"offline reason shown in Korean");
        expect(MeetingService.safeMessage(new java.net.SocketTimeoutException("timeout")).contains("응답이 늦어"),"timeout reason shown in Korean");
        File dir=store.directory(3,record.getString("id"));String text=new String(new char[6000]).replace('\0','가');
        replies.add("{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}");replies.add(completed());replies.add(completed());
        Ai ai=new Ai(store,message->{});JSONObject answer=ai.section(record,text,null,dir,0);
        expect(requests.size()==3,"output limit splits into two requests");expect(ai.extra==2,"bounded extra requests");
        JSONObject lastRequest=new JSONObject(requests.get(2));JSONArray messages=lastRequest.getJSONArray("input");JSONObject payload=new JSONObject(messages.getJSONObject(messages.length()-1).getString("content"));
        expect(payload.has("previousMinutes"),"previous details supplied to next section");
        expect(lastRequest.getString("model").equals("gpt-6.1-sol"),"Sol model");
        expect(lastRequest.getInt("max_output_tokens")==32000,"output budget");
        expect(!lastRequest.has("temperature")&&lastRequest.getJSONObject("reasoning").getString("effort").equals("medium"),"reasoning model parameters");
        expect(payload.getString("notes").startsWith("1. 탭 구조"),"meeting notes sent as reference");
        JSONObject aiUsage=record.getJSONObject("analysis").getJSONArray("usage").getJSONObject(0);
        expect(aiUsage.getString("kind").equals("summary")&&aiUsage.getString("model").equals("gpt-6.1-sol")&&aiUsage.getInt("requests")==3&&aiUsage.getInt("unknownRequests")==3&&aiUsage.getLong("totalTokens")==0,"split requests counted and missing usage kept unknown");
        expect(record.getJSONObject("analysis").getJSONArray("callIds").length()==3,"one call id per sent request");
        new Ai(store,message->{}).section(record,text,null,dir,0);expect(requests.size()==3,"successful result survives new analyzer");
        Store.write(new File(dir,"전사.txt"),"원문 보존 시험");store.finish(record,answer);
        expect(store.load(3,record.getString("id")).getString("title").equals("표준 문서 구현 준비"),"AI title persisted");
        expect(Store.read(new File(dir,"회의록.txt")).contains("핵심 요약"),"summary document saved");
        expect(!Store.read(new File(dir,"회의록.txt")).contains("원문 보존 시험"),"raw transcript excluded from minutes");
        expect(Store.read(new File(dir,"전사.txt")).equals("원문 보존 시험"),"raw transcript kept separately");
        code=429;replies.add("{\"error\":{\"code\":\"insufficient_quota\"}}");int before=requests.size();
        try{new Ai(store,message->{}).section(second,"잔액 제한 시험",null,store.directory(3,second.getString("id")),0);throw new AssertionError("quota must fail");}catch(IOException ex){expect(ex.getMessage().contains("사용 한도"),"quota distinguished from length");}
        expect(requests.size()==before+1,"quota never creates split retries");
        expect(store.load(3,second.getString("id")).getJSONObject("analysis").getJSONArray("usage").getJSONObject(0).getInt("unknownRequests")==1,"failed sent request saved as unknown usage");
        code=200;record.getJSONArray("audio").put("원음-001.m4a");Store.write(new File(dir,"전사-001.txt"),"저장된 전사 재사용");replies.add(new JSONObject(completed()).put("model","gpt-6.1-sol-2026-09-15").put("usage",new JSONObject().put("input_tokens",40).put("output_tokens",10).put("total_tokens",50)).toString());before=requests.size();new Ai(store,message->{}).run(record);
        expect(requests.size()==before+1,"saved transcript avoids retranscription");
        JSONArray models=record.getJSONObject("analysis").getJSONArray("usage");JSONObject snapshot=null;for(int i=0;i<models.length();i++)if(models.getJSONObject(i).getString("model").equals("gpt-6.1-sol-2026-09-15"))snapshot=models.getJSONObject(i);
        expect(snapshot!=null&&snapshot.getLong("totalTokens")==50&&snapshot.getInt("measuredRequests")==1,"usage recorded under actual response model");
        expect(record.getJSONObject("analysis").getString("summaryModel").equals("gpt-6.1-sol"),"selected model kept separately");
        expect(record.getString("state").equals("complete"),"analysis finished");
        expect(replies.isEmpty(),"all mock responses consumed");
        JSONArray realMeetings=store.history(1);
        if(realMeetings.length()>0){JSONObject real=realMeetings.getJSONObject(0);JSONArray files=real.getJSONArray("audio");if(files.length()>0){
            android.media.MediaMetadataRetriever media=new android.media.MediaMetadataRetriever();
            try{media.setDataSource(new File(store.directory(1,real.getString("id")),files.getString(0)).getAbsolutePath());expect(Long.parseLong(media.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION))>5000,"recorded audio is playable and longer than five seconds");}finally{media.release();}
        }}
        File[] shares=new File(getTargetContext().getCacheDir(),"공유").listFiles();
        if(shares!=null)for(File share:shares)if(share.getName().endsWith(".zip")){try(java.util.zip.ZipFile zip=new java.util.zip.ZipFile(share)){
            expect(zip.getEntry("회의록.txt")!=null&&zip.getEntry("전사.txt")!=null,"share archive includes minutes and transcript");
            expect(zip.getEntry("personal.key")==null,"share archive excludes API key");
        }}
        settingsFormatAndTrial(store);
        store.summaryModel(previousModel);
        result.putString("stream","PASS "+checks+" native storage and recovery checks; real API calls=0\n");finish(-1,result);
    }catch(Throwable ex){result.putString("stream","FAIL "+ex.toString()+"\n");finish(0,result);}}
}
