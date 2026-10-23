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
    static int meetingFiles(File dir){int n=0;File[] items=dir.listFiles();if(items!=null)for(File f:items)n+=f.isDirectory()?count(f):0;return n;}
    static int count(File dir){int n=0;File[] items=dir.listFiles();if(items!=null)for(File f:items)n+=f.isDirectory()?count(f):1;return n;}
    static JSONObject analyzable(Store store,String title)throws Exception{
        // 저장된 전사를 다시 쓰는 회의 기록을 만들어 전사 요청 없이 요약 요청만 보내게 한다.
        JSONObject record=store.create(new JSONObject().put("date","2099-01-05").put("title",title));record.getJSONArray("audio").put("원음-001.m4a");store.save(record);
        Store.write(new File(store.directory("main",record.getString("id")),"전사-001.txt"),"체험 검증 전사");return record;
    }
    static String firstSystem(String body)throws Exception{return new JSONObject(body).getJSONArray("input").getJSONObject(0).getString("content");}
    static void settingsChecks(Store store)throws Exception{
        android.content.SharedPreferences prefs=store.context.getSharedPreferences("connection",0);
        prefs.edit().putString("summaryModel","gpt-6-luna").putString("defaultOutputFormat","summary").putString("storage.audio","content://합성/옛폴더").commit();
        JSONObject custom=new JSONObject().put("name","기존 형식").put("sections",new JSONArray().put(new JSONObject().put("key","overview").put("title","요약"))).put("instruction","");
        store.saveCustomFormat(custom);Store.write(store.customFile()," \n"+custom.toString()+" \n");
        String before=Store.read(store.customFile());JSONObject record=legacy(store,1,"2099-03-01","설정과 무관한 기록","100");
        String metadata=Store.read(new File(store.directory("p1",record.getString("id")),"회의정보.json"));
        CustomFormat nextCustom=CustomFormat.parse(custom.put("name","새 형식").toString());
        SettingsFile.Value next=new SettingsFile.Value("gpt-6-astra","tasks",nextCustom);
        for(int point:new int[]{1,2}){
            Store.failImportAfter=point;
            try{store.importSettings(next);throw new AssertionError("설정 중간 실패가 필요합니다.");}catch(IOException ex){expect(ex.getMessage().contains("되돌렸"),"중간 저장 실패를 알린다");}
            expect(store.summaryModel().equals("gpt-6-luna")&&store.defaultOutputFormat().equals("summary")&&Store.read(store.customFile()).equals(before),"모델·기본 형식·내 형식 원래 바이트를 함께 복구한다");
        }
        Store.failImportAfter=2;
        try{store.importSettings(new SettingsFile.Value("gpt-6-astra","custom",null));throw new AssertionError("삭제 뒤 실패가 필요합니다.");}catch(IOException ex){expect(Store.read(store.customFile()).equals(before),"내 형식을 지운 뒤 실패해도 원래 파일을 복구한다");}
        Store.failImportAfter=-1;
        store.importSettings(next);
        expect(store.summaryModel().equals("gpt-6-astra")&&store.defaultOutputFormat().equals("tasks")&&store.customFormat().getString("name").equals("새 형식"),"2판 설정 값을 모두 적용한다");
        JSONObject unknown=store.importSettings(new SettingsFile.Value("아직 없는 모델","custom",null));
        expect(store.summaryModel().equals("gpt-6-astra")&&unknown.getJSONArray("skipped").length()==1,"없는 모델은 건너뛰고 알린다");
        expect(store.customFormat()==null,"명시적인 null은 지금 내 형식을 지운다");
        expect(store.create(new JSONObject().put("date","2099-03-02")).getString("outputFormat").equals("meeting"),"기본 내 형식이 없으면 새 회의를 회의록으로 시작한다");
        store.saveCustomFormat(custom);
        expect(store.create(new JSONObject().put("date","2099-03-02")).getJSONObject("customFormat").getString("name").equals("새 형식"),"기본 내 형식이 있으면 새 회의에 정의를 보관한다");
        String imported=new String(SettingsFile.write(next),StandardCharsets.UTF_8);imported=imported.substring(0,imported.length()-1)+",\"storage\":{\"audio\":\"D:\\\\다른PC\",\"transcript\":\"\",\"summary\":\"\"}}";
        store.importSettings(SettingsFile.read(imported.getBytes(StandardCharsets.UTF_8)));
        expect(prefs.getString("storage.audio","").equals("content://합성/옛폴더"),"Windows 저장 위치가 Android 기기 설정을 바꾸지 않는다");
        String exported=new String(store.exportSettings(),StandardCharsets.UTF_8);
        expect(!exported.contains("\"storage\"")&&!exported.contains("\"key\"")&&!exported.contains("trial")&&SettingsFile.read(store.exportSettings()).defaultOutputFormat.equals("tasks"),"2판 내보내기는 키·체험·저장 위치를 빼고 현재 설정만 담는다");
        expect(Store.read(new File(store.directory("p1",record.getString("id")),"회의정보.json")).equals(metadata),"설정 불러오기는 옛 회의 파일을 고치지 않는다");
        store.saveSettings(new JSONObject().put("defaultOutputFormat","summary"));
        expect(store.defaultOutputFormat().equals("summary"),"기본 출력 형식만 저장할 수 있다");
        try{store.saveSettings(new JSONObject().put("defaultOutputFormat",new JSONArray().put("meeting")));throw new AssertionError("배열 형식은 거절합니다.");}catch(IOException ex){expect(store.defaultOutputFormat().equals("summary"),"잘못된 기본 형식은 기존 값을 보존한다");}
    }
    static void settingsFormatAndTrial(Store store)throws Exception{
        android.content.SharedPreferences prefs=store.context.getSharedPreferences("connection",0);String savedKey=prefs.getString("key",null);
        TrialAccess previousTrial=Store.trial;String previousSession=Store.sessionKey;
        try{
            JSONObject tasks=analyzable(store,"형식 검증");tasks.put("outputFormat","tasks");store.save(tasks);expect(tasks.getString("outputFormat").equals("tasks"),"meeting keeps its selected output format");
            int sent=requests.size();replies.add(completed());new Ai(store,message->{}).run(tasks);
            JSONObject tasksRequest=new JSONObject(requests.get(sent));
            expect(firstSystem(requests.get(sent)).equals(store.asset("summary-tasks.json").getJSONArray("input").getJSONObject(0).getString("content"))&&!firstSystem(requests.get(sent)).equals(store.asset("summary-meeting.json").getJSONArray("input").getJSONObject(0).getString("content")),"tasks format sends tasks instructions");
            expect(tasksRequest.getInt("max_output_tokens")==32000&&tasksRequest.getString("model").equals("gpt-6.1-sol")&&tasksRequest.getJSONObject("text").toString().equals(store.asset("summary-meeting.json").getJSONObject("text").toString()),"same model, budget and minutes schema for every format");
            JSONObject user=new JSONObject(tasksRequest.getJSONArray("input").getJSONObject(tasksRequest.getJSONArray("input").length()-1).getString("content"));
            expect(!user.has("outputFormat")&&user.has("transcript"),"user message fields unchanged");
            String tasksText=Store.read(new File(store.directory("main",tasks.getString("id")),"회의록.txt"));
            expect(tasksText.contains("업무 정리")&&tasksText.contains("할 일\n- 화면 기획 · 담당 미정 · 기한 미정"),"tasks document lists undecided owner and due");
            JSONObject loaded=store.load("main",tasks.getString("id"));expect(loaded.getString("outputFormat").equals("tasks")&&loaded.getString("state").equals("complete"),"format kept in saved record");
            sent=requests.size();replies.add(completed());new Ai(store,message->{}).run(loaded);
            expect(firstSystem(requests.get(sent)).equals(firstSystem(requests.get(sent-1))),"reanalysis keeps the record's format");
            // 내 형식: 저장·조회, 회의 기록의 당시 정의, AI 요청의 두 번째 지시, 저장 본문의 항목 순서
            JSONObject savedCustom=store.saveCustomFormat(new JSONObject().put("name"," 주간 보고 ").put("sections",new JSONArray().put(new JSONObject().put("key","actions").put("title","이번 주 할 일")).put(new JSONObject().put("key","overview").put("title","한 줄 요약"))).put("instruction","부서별로 / 묶기"));
            expect(savedCustom.getString("name").equals("주간 보고")&&store.customFormat().toString().equals(savedCustom.toString()),"custom format saved and read");
            try{store.saveCustomFormat(new JSONObject().put("name","").put("sections",new JSONArray()));throw new AssertionError("bad custom");}catch(IOException ex){expect(ex.getMessage().contains("이름"),"invalid custom format rejected");}
            JSONObject customRecord=store.create(new JSONObject().put("date","2099-01-06").put("title","내 형식 회의").put("outputFormat","custom").put("customFormat",savedCustom));
            expect(Store.meetingFormat(customRecord).equals("custom")&&customRecord.getJSONObject("customFormat").getString("name").equals("주간 보고"),"meeting keeps its custom definition");
            customRecord.getJSONArray("audio").put("원음-001.m4a");store.save(customRecord);Store.write(new File(store.directory("main",customRecord.getString("id")),"전사-001.txt"),"내 형식 전사");
            sent=requests.size();replies.add(completed());new Ai(store,message->{}).run(customRecord);
            JSONArray customInput=new JSONObject(requests.get(sent)).getJSONArray("input");
            expect(customInput.getJSONObject(1).getString("content").equals(Store.custom(customRecord).instruction())&&customInput.getJSONObject(0).getString("content").equals(store.asset("summary-meeting.json").getJSONArray("input").getJSONObject(0).getString("content")),"custom instruction sent right after meeting instructions");
            String customText=Store.read(new File(store.directory("main",customRecord.getString("id")),"회의록.txt"));
            expect(customText.indexOf("이번 주 할 일")>0&&customText.indexOf("이번 주 할 일")<customText.indexOf("한 줄 요약")&&!customText.contains("합의된 방향"),"custom document follows chosen order");
            try{store.create(new JSONObject().put("date","2099-01-06").put("outputFormat","custom"));throw new AssertionError("custom without definition");}catch(IOException ex){expect(true,"custom meeting needs definition");}
            store.deleteCustomFormat();expect(store.customFormat()==null,"custom format deleted");
            JSONObject legacy=new JSONObject().put("title","옛 회의").put("date","2026-09-30").put("dailySequence",1);
            expect(Store.format(legacy,minutes()).contains("상세 회의 내용")&&Store.format(new JSONObject(legacy.toString()).put("outputFormat","summary"),minutes()).contains("주요 내용"),"old records keep meeting layout, summary has its layout");
            expect(Store.format(new JSONObject(legacy.toString()).put("outputFormat","custom"),minutes()).contains("상세 회의 내용"),"내 형식 정의가 없는 옛 결과도 회의록으로 열고 복사한다");

            // 공용 기본 키 체험: 개인 키를 잠시 비우고 시험용 상태 파일과 모의 키로만 확인한다.
            Store.sessionKey=null;prefs.edit().remove("key").commit();
            Store.testDefaultKey="sk-mock-default-000000000000";Store.trial=new TrialAccess(new File(store.context.getCacheDir(),"trial-check-"+UUID.randomUUID()+".json"));
            expect(store.access().accessMode.equals("trial")&&store.access().trialRemaining==3,"default key starts with 3 trial analyses");
            JSONObject first=analyzable(store,"체험 1");sent=requests.size();
            replies.add("{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}");replies.add(completed());replies.add(completed());
            String long1=new String(new char[6000]).replace('\0','나');Store.write(new File(store.directory("main",first.getString("id")),"전사-001.txt"),long1);
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
        }
    }
    static JSONObject legacy(Store store,int slot,String date,String title,String version)throws Exception {
        String id=UUID.randomUUID().toString();File dir=new File(new File(store.root,String.format(Locale.ROOT,"프로젝트-%02d",slot)),id);
        JSONObject record=new JSONObject().put("id",id).put("slot",slot).put("projectName","옛 업무 "+slot).put("date",date).put("title",title).put("dailySequence",7)
            .put("participants","예시 참석자").put("outputFormat","tasks").put("state","complete").put("createdAt",100L).put("audio",new JSONArray());
        Store.write(new File(dir,"회의정보.json"),record.toString());Store.write(new File(dir,"요약.json"),minutes().put("overview",title+" 본문").toString());
        Store.write(new File(dir,"전사.txt"),"옛 전사 원문");if(version!=null)Store.write(new File(dir,"요약-"+version+".json"),minutes().toString());return record;
    }
    static void archiveChecks(Store store)throws Exception {
        JSONObject one=legacy(store,1,"2099-02-01","옛 첫째","1234"),two=legacy(store,2,"2099-02-02","옛 둘째",null),three=legacy(store,3,"2099-02-03","옛 셋째","2345");
        String original=Store.read(new File(new File(new File(store.root,"프로젝트-01"),one.getString("id")),"회의정보.json"));
        JSONObject all=store.history();
        expect(all.getJSONArray("meetings").length()==3,"옛 세 보관함을 한 목록으로 읽는다");
        expect(all.getJSONArray("meetings").getJSONObject(0).getString("location").equals("p3"),"날짜 최신순과 보관함을 함께 돌려준다");
        JSONObject fresh=store.create(new JSONObject().put("date","2099-02-01").put("title",""));
        expect(fresh.getString("location").equals("main")&&!fresh.has("slot")&&!fresh.has("projectName"),"새 녹음은 프로젝트 없이 main에 쌓인다");
        JSONObject again=store.create(new JSONObject().put("date","2099-02-01"));
        expect(fresh.getInt("dailySequence")==1&&again.getInt("dailySequence")==2,"새 보관함 안에서만 날짜별 차수를 센다");
        File broken=new File(new File(store.root,"프로젝트-02"),UUID.randomUUID().toString());Store.write(new File(broken,"회의정보.json"),"{broken");
        File wrong=new File(new File(store.root,"프로젝트-03"),UUID.randomUUID().toString());Store.write(new File(wrong,"회의정보.json"),new JSONObject(one.toString()).put("id",wrong.getName()).toString());
        Store.write(new File(store.root,"프로젝트-01/남은.tmp"),"tmp");Store.write(new File(store.root,"프로젝트-01/다른.txt"),"다른 파일");
        all=store.history();
        expect(all.getJSONArray("meetings").length()==5&&all.getInt("skipped")==2,"손상·잘못된 보관함 기록만 빼고 tmp와 다른 파일은 무시한다");
        expect(Store.read(new File(new File(new File(store.root,"프로젝트-01"),one.getString("id")),"회의정보.json")).equals(original),"옛 목록을 읽어도 원본 메타데이터를 고치지 않는다");
        JSONObject old=store.load("p1",one.getString("id"));
        JSONObject oldResult=store.result("p1",one.getString("id"),null);
        expect(oldResult.getString("resultId").equals("1234")&&oldResult.getString("title").equals("옛 첫째"),"옛 최신 요약 시각으로 결과를 연다");
        JSONObject fallback=store.result("p2",two.getString("id"),null);
        expect(fallback.getString("resultId").equals("legacy"),"옛 시각 파일이 없으면 legacy로 연다");
        store.saveReview("p1",one.getString("id"),"1234",4,"앞선 평가");
        old.put("outputFormat","summary");
        store.save(old);
        expect(store.result("p1",one.getString("id"),"1234").getString("outputFormat").equals("tasks"),"상태 갱신부터 시작해도 옛 결과 형식을 먼저 보존한다");
        store.finish(old,minutes().put("suggestedTitle","새 제목"),"새 의견");
        JSONObject preserved=store.result("p1",one.getString("id"),"1234");
        expect(preserved.getString("title").equals("옛 첫째")&&preserved.getString("outputFormat").equals("tasks")&&preserved.getJSONObject("minutes").getString("overview").equals("옛 첫째 본문"),"다시 분석해도 옛 본문·제목·형식이 남는다");
        JSONArray versions=store.results("p1",one.getString("id"));
        expect(versions.length()==2&&versions.getJSONObject(0).getInt("stars")==4,"옛 평가와 새 결과를 버전으로 나란히 연다");
        JSONObject latest=store.result("p1",one.getString("id"),null);
        expect(!latest.has("slot")&&latest.getString("location").equals("p1")&&latest.getString("projectName").equals("옛 업무 1")&&latest.getString("feedback").equals("새 의견"),"옛 보관함의 새 결과는 location과 꼬리표·의견을 보존한다");
        expect(store.loadReview("p1",one.getString("id"),latest.getString("resultId"))==null,"새 결과에 앞선 평가가 따라붙지 않는다");
        store.saveReview("p1",one.getString("id"),latest.getString("resultId"),null,"새 결과 의견");
        expect(store.loadReview("p1",one.getString("id"),"1234").getInt("stars")==4&&store.loadReview("p1",one.getString("id"),latest.getString("resultId")).isNull("stars"),"별점 없는 의견도 저장하고 결과마다 평가를 분리한다");
        all=store.history();
        int count=0;for(int i=0;i<all.getJSONArray("meetings").length();i++)if(all.getJSONArray("meetings").getJSONObject(i).getString("id").equals(one.getString("id")))count++;
        expect(count==1,"여러 결과도 회의 목록에는 하나만 나온다");
        File p1=new File(store.root,"프로젝트-01"),p2=new File(store.root,"프로젝트-02"),p3=new File(store.root,"프로젝트-03");
        Store.write(new File(p1,"작성중.json"),new JSONObject().put("title","오래된 메모").put("notes","안건").toString());new File(p1,"작성중.json").setLastModified(1000);
        Store.write(new File(p2,"작성중.json"),new JSONObject().put("title","가져올 메모").put("notes","안건").toString());new File(p2,"작성중.json").setLastModified(2000);
        Store.write(new File(p3,"작성중.json"),"{broken");new File(p3,"작성중.json").setLastModified(3000);
        JSONObject draft=store.draft();
        expect(draft.getString("title").equals("가져올 메모"),"손상된 최근 초안은 건너뛰고 다음 초안을 이관한다");
        store.clearDraft();
        expect((new Store(store.context).draft()).length()==0,"녹음 뒤 다시 열어도 옛 메모가 되살아나지 않는다");
        expect(new File(p1,"작성중.json").exists()&&new File(p2,"작성중.json").exists()&&new File(p3,"작성중.json").exists(),"옛 메모 파일을 지우지 않는다");
    }
    android.content.Context testContext(){
        return new android.content.ContextWrapper(getTargetContext()){
            final String name="task10-"+UUID.randomUUID();
            public android.content.Context getApplicationContext(){return this;}
            public File getFilesDir(){File file=new File(getBaseContext().getCacheDir(),name);file.mkdirs();return file;}
            public File getCacheDir(){return getFilesDir();}
            public android.content.SharedPreferences getSharedPreferences(String key,int mode){return getBaseContext().getSharedPreferences(name+"-"+key,mode);}
        };
    }
    void draftFailureCheck()throws Exception {
        Store store=new Store(testContext());
        Store.write(new File(store.root,"프로젝트-01/작성중.json"),new JSONObject().put("title","다시 가져올 초안").toString());
        Store.write(store.locationDirectory("main"),"합성 저장 실패를 만드는 파일");
        try{store.draft();throw new AssertionError("새 초안을 저장하지 못했으면 이관 성공으로 처리하지 않는다");}catch(IOException expected){}
        expect(!store.context.getSharedPreferences("connection",0).getBoolean("draftMigrated",false),"초안 쓰기 실패 뒤에도 다음 실행에 이관을 다시 시도한다");
    }
    @Override public void onStart(){Bundle result=new Bundle();try{
        archiveChecks(new Store(testContext()));
        settingsChecks(new Store(testContext()));
        draftFailureCheck();
        URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){return new HttpURLConnection(url){
            final ByteArrayOutputStream sent=new ByteArrayOutputStream();
            public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
            public void setRequestProperty(String key,String value){if("Authorization".equals(key))lastAuth=value;}
            public OutputStream getOutputStream(){return sent;}
            public int getResponseCode(){return code;}
            public InputStream getInputStream()throws IOException{requests.add(new String(sent.toByteArray(),StandardCharsets.UTF_8));auths.add(lastAuth);String next=replies.poll();if(next==null)throw new IOException("Unexpected network request");return new ByteArrayInputStream(next.getBytes(StandardCharsets.UTF_8));}
            public InputStream getErrorStream(){try{return getInputStream();}catch(IOException ex){throw new RuntimeException(ex);}}
        };}}:null);
        Store store=new Store(testContext());
        String previousModel=store.summaryModel();store.summaryModel(null);
        boolean bundledKey=true;try{getTargetContext().getAssets().open("personal.key").close();}catch(FileNotFoundException absent){bundledKey=false;}
        expect(!bundledKey,"installer has no bundled API key");
        boolean defaultKey=true;try{getTargetContext().getAssets().open("default.key").close();}catch(FileNotFoundException absent){defaultKey=false;}
        expect(!defaultKey,"test build has no real default key");
        String savedKey=store.context.getSharedPreferences("connection",0).getString("key",null);
        Store.sessionKey=null;if(savedKey==null)expect(store.key().isEmpty()&&store.keySource().equals("none"),"missing key reads as empty instead of crashing");
        try{store.key("bad",true);throw new AssertionError("bad key must fail");}catch(IOException ex){expect(ex.getMessage().contains("형식"),"bad key reason shown");}
        store.key("sk-mock-only-0000000000000000",false);expect(store.keySource().equals("session")&&store.key().startsWith("sk-mock"),"session key used without persisting");
        expect(store.context.getSharedPreferences("connection",0).getString("key",null)==null,"session key not written to storage");
        store.saveDraft(new JSONObject().put("title","초안").put("date","2099-01-02").put("notes","안건 초안"));expect(store.draft().getString("notes").equals("안건 초안"),"draft survives reload");store.clearDraft();expect(store.draft().length()==0,"draft cleared after start");
        try{store.create(new JSONObject().put("date","2099-01-01").put("notes",new String(new char[4001]).replace('\0','가')));throw new AssertionError("long notes must fail");}catch(IOException ex){expect(ex.getMessage().contains("4,000"),"notes limit enforced");}
        JSONObject input=new JSONObject().put("date","2099-01-01").put("title","검증 회의").put("notes","1. 탭 구조 결정\n2. 기존 DB 재사용");
        JSONObject record=store.create(input),second=store.create(input);
        expect(second.getInt("dailySequence")==record.getInt("dailySequence")+1,"same day sequence");
        expect(store.load("main",record.getString("id")).getString("notes").startsWith("1. 탭 구조"),"meeting notes saved and loaded");
        expect(MeetingService.safeMessage(new java.net.UnknownHostException("Unable to resolve host \"api.openai.com\"")).startsWith("인터넷에 연결할 수 없습니다"),"offline reason shown in Korean");
        expect(MeetingService.safeMessage(new java.net.SocketTimeoutException("timeout")).contains("응답이 늦어"),"timeout reason shown in Korean");
        File dir=store.directory("main",record.getString("id"));String text=new String(new char[6000]).replace('\0','가');
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
        Store.write(new File(dir,"전사.txt"),"원문 보존 시험");store.finish(record,answer,null);
        expect(store.load("main",record.getString("id")).getString("title").equals("표준 문서 구현 준비"),"AI title persisted");
        expect(Store.read(new File(dir,"회의록.txt")).contains("핵심 요약"),"summary document saved");
        expect(!Store.read(new File(dir,"회의록.txt")).contains("원문 보존 시험"),"raw transcript excluded from minutes");
        expect(Store.read(new File(dir,"전사.txt")).equals("원문 보존 시험"),"raw transcript kept separately");
        code=429;replies.add("{\"error\":{\"code\":\"insufficient_quota\"}}");int before=requests.size();
        try{new Ai(store,message->{}).section(second,"잔액 제한 시험",null,store.directory("main",second.getString("id")),0);throw new AssertionError("quota must fail");}catch(IOException ex){expect(ex.getMessage().contains("사용 한도"),"quota distinguished from length");}
        expect(requests.size()==before+1,"quota never creates split retries");
        expect(store.load("main",second.getString("id")).getJSONObject("analysis").getJSONArray("usage").getJSONObject(0).getInt("unknownRequests")==1,"failed sent request saved as unknown usage");
        code=200;record.getJSONArray("audio").put("원음-001.m4a");Store.write(new File(dir,"전사-001.txt"),"저장된 전사 재사용");replies.add(new JSONObject(completed()).put("model","gpt-6.1-sol-2026-09-15").put("usage",new JSONObject().put("input_tokens",40).put("output_tokens",10).put("total_tokens",50)).toString());before=requests.size();new Ai(store,message->{}).run(record);
        expect(requests.size()==before+1,"saved transcript avoids retranscription");
        JSONArray models=record.getJSONObject("analysis").getJSONArray("usage");JSONObject snapshot=null;for(int i=0;i<models.length();i++)if(models.getJSONObject(i).getString("model").equals("gpt-6.1-sol-2026-09-15"))snapshot=models.getJSONObject(i);
        expect(snapshot!=null&&snapshot.getLong("totalTokens")==50&&snapshot.getInt("measuredRequests")==1,"usage recorded under actual response model");
        expect(record.getJSONObject("analysis").getString("summaryModel").equals("gpt-6.1-sol"),"selected model kept separately");
        expect(record.getString("state").equals("complete"),"analysis finished");
        expect(replies.isEmpty(),"all mock responses consumed");
        settingsFormatAndTrial(store);
        store.summaryModel(previousModel);
        result.putString("stream","PASS "+checks+" native storage and recovery checks; real API calls=0\n");finish(-1,result);
    }catch(Throwable ex){result.putString("stream","FAIL "+ex.toString()+"\n");finish(0,result);}}
}
