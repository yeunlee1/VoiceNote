// 저장된 녹음을 전사하고 선택한 모델로 요약을 누적 생성하며 길이 한도 오류를 복구한다.
package kr.local.meetingjournal;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

final class Ai {
    interface Progress {void update(String message) throws Exception;}
    interface Templates {String read(String name)throws Exception;}
    static final class Limit extends IOException {Limit(String message){super(message);}}
    static final String DEFAULT_MODEL=AiModels.DEFAULT_MODEL;
    static String checkedFeedback(Object value)throws IOException {
        if(!(value instanceof String)||JsonText.trim((String)value).isEmpty())throw new IOException("반영할 의견을 입력하세요.");
        String text=(String)value;if(text.length()>1000)throw new IOException("의견은 1,000자 이하로 입력하세요.");return text;
    }
    final Store store; final Progress progress; final AiModels.Model model; final String analysisId; final Templates templates; int extra;
    JSONObject usageTarget;
    TrialAccess.Gate gate;
    Ai(Store store,Progress progress) throws Exception {this(store,progress,name->{try(InputStream in=store.context.getAssets().open(name)){return Store.read(in);}});}
    Ai(Store store,Progress progress,Templates templates) throws Exception {
        // 분석 시도 하나에 ID 하나를 두고, 전사·분할 요약·자동 재시도가 같은 체험 예약을 함께 쓴다.
        this.store=store;this.progress=progress;this.templates=templates;analysisId=UUID.randomUUID().toString();store.requireAccess();
        String selected=store.summaryModel();model=AiModels.find(selected==null?DEFAULT_MODEL:selected);
        if(model==null)throw new IOException("선택한 요약 모델("+selected+")은 지원 목록에 없습니다. 설정의 AI 연결에서 요약 모델을 다시 선택하세요.");
    }
    static JSONArray models() throws JSONException {
        JSONArray all=new JSONArray();
        for(AiModels.Model m:AiModels.ALL)all.put(new JSONObject().put("id",m.id).put("label",m.label).put("description",m.description).put("maxOutputTokens",m.maxOutputTokens).put("modelMaxOutputTokens",m.modelMaxOutputTokens).put("reasoningEffort",m.reasoningEffort));
        return all;
    }
    void check() throws IOException {if(Thread.currentThread().isInterrupted())throw new IOException("분석을 중단했습니다. 저장된 자료는 유지됩니다.");}
    HttpURLConnection connect(String route,String type) throws Exception {
        check();
        // 실제 요청 직전에 체험권한을 확인하고, 허용된 쪽(개인 키 또는 공용 기본 키)의 키만 쓴다.
        String personal=store.key(),fallback=store.defaultKey();
        gate=store.trial().begin(analysisId,!personal.isEmpty(),!fallback.isEmpty());
        if(!gate.allowed)throw new IOException(gate.message);
        String key="personal".equals(gate.useKey)?personal:fallback;
        HttpURLConnection connection=(HttpURLConnection)new URL("https://api.openai.com/v1/"+route).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(30000);connection.setReadTimeout(300000);
        connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Authorization","Bearer "+key);connection.setRequestProperty("Content-Type",type);return connection;
    }
    JSONObject response(HttpURLConnection connection) throws Exception {
        int status=connection.getResponseCode();String data;try(InputStream in=status<400?connection.getInputStream():connection.getErrorStream()){data=in==null?"{}":Store.read(in);}finally{connection.disconnect();}
        check();JSONObject body=new JSONObject(data);
        if(status>=200&&status<300&&gate!=null&&gate.reserved)store.trial().markSucceeded(analysisId);
        if(status<200||status>=300){String code=body.optJSONObject("error")==null?"":body.getJSONObject("error").optString("code");
            if(code.equals("context_length_exceeded"))throw new Limit("입력 길이 한도");
            if(status==401||status==403)throw new IOException("API 키 또는 모델 사용 권한을 확인하세요.");
            if(code.contains("quota")||code.contains("balance")||code.contains("spend_limit")||code.contains("usage_limit"))throw new IOException("API 잔액 또는 사용 한도를 확인하세요. 전사와 녹음은 저장되어 있습니다.");
            if(code.equals("model_not_found"))throw new IOException("현재 API 계정에서 요약 모델("+model.id+")을 사용할 수 없습니다. 설정의 AI 연결에서 다른 모델을 선택하거나 계정 권한을 확인하세요.");
            if(status==429)throw new IOException("API 처리량 제한입니다. 잠시 후 다시 분석하세요.");
            throw new IOException("AI 요청에 실패했습니다. HTTP "+status);
        }return body;
    }
    String transcribe(JSONObject record,File file) throws Exception {
        String boundary="Meeting"+UUID.randomUUID().toString().replace("-","");HttpURLConnection c=connect("audio/transcriptions","multipart/form-data; boundary="+boundary);
        c.setChunkedStreamingMode(8192);
        try(OutputStream out=c.getOutputStream()){
            field(out,boundary,"model",AiModels.TRANSCRIPTION_MODEL);field(out,boundary,"languages[]","ko");field(out,boundary,"response_format","json");
            out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\"meeting.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            try(InputStream in=new FileInputStream(file)){byte[] b=new byte[8192];for(int n;(n=in.read(b))!=-1;){check();out.write(b,0,n);}}
            out.write(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
        }catch(Exception ex){c.disconnect();throw ex;}
        return sent(record,c,AiUsage.TRANSCRIPTION,AiModels.TRANSCRIPTION_MODEL).getString("text");
    }
    void field(OutputStream out,String boundary,String name,String value) throws IOException {out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").getBytes(StandardCharsets.UTF_8));}
    void run(JSONObject record) throws Exception {
        // 회의록까지 저장하면 체험 1회로 확정하고, 실패·취소면 예약만 돌려준다.
        try{analyze(record);}catch(Exception ex){store.trial().release(analysisId);throw ex;}
        finishAccess(record);
        copyResult(record);
    }
    void finishAccess(JSONObject record)throws Exception {
        for(int attempt=0;;attempt++){
            try{store.trial().finish(analysisId);return;}
            catch(TrialAccess.StorageException ex){
                // 회의록은 이미 저장했으므로 완료 상태는 두고 안내만 덧붙인다. 예약은 남아 앱을 다시 열면 회수된다.
                if(attempt>=2){record.put("message",record.optString("message")+" · 체험 횟수 기록을 저장하지 못했습니다.");store.save(record);return;}
                Thread.sleep(200);}
        }
    }
    JSONObject refine(JSONObject record,String resultId,String feedback)throws Exception {
        feedback=checkedFeedback(feedback);
        String location=Store.location(record),id=record.getString("id");File dir=store.directory(location,id),file=new File(dir,"전사.txt");
        if(!file.isFile())throw new IOException("저장된 전사가 없어 의견을 반영할 수 없습니다.");
        String transcript=Store.read(file);if(JsonText.trim(transcript).isEmpty())throw new IOException("저장된 전사가 없어 의견을 반영할 수 없습니다.");
        JSONObject selected=store.result(location,id,resultId);
        if(selected.optJSONObject("minutes")==null)throw new IOException("정리된 결과에만 의견을 반영할 수 있습니다.");
        usageTarget=store.load(location,id);JSONObject work=new JSONObject(selected.toString());work.remove("minutes");
        if(usageTarget.has("analysis"))work.put("analysis",new JSONObject(usageTarget.getJSONObject("analysis").toString()));else work.remove("analysis");
        try{
            JSONObject previous=null;List<String> chunks=TextChunks.split(transcript,24000);
            for(int i=0;i<chunks.size();i++){progress.update(model.label+" 의견 반영 중 · "+(i+1)+" / "+chunks.size());previous=section(work,chunks.get(i),previous,dir,0,feedback);}
            analysis(work).put("summaryModel",model.id);String before=work.getString("resultId");
            try{store.finish(work,previous,feedback);}finally{
                if(!before.equals(work.optString("resultId"))){
                    List<String> keys=new ArrayList<>();for(Iterator<String> it=record.keys();it.hasNext();)keys.add(it.next());for(String key:keys)record.remove(key);
                    for(Iterator<String> it=work.keys();it.hasNext();){String key=it.next();record.put(key,work.get(key));}
                }
            }
        }catch(Exception ex){store.trial().release(analysisId);throw ex;}finally{usageTarget=null;}
        finishAccess(record);copyResult(record);return record;
    }
    void copyResult(JSONObject record)throws Exception {
        JSONObject copies;
        try{copies=Copies.copyResult(store.context,store,Store.location(record),record.getString("id"),record.getString("resultId"));}
        catch(Exception ex){copies=new JSONObject().put("ok",false).put("written",new JSONArray()).put("skipped",new JSONArray()).put("failed",new JSONArray().put(new JSONObject().put("kind","all").put("message","사본 저장을 마치지 못했습니다")));}
        record.put("copies",copies);
        String failure=copyFailureMessage(copies);
        if(!failure.isEmpty())record.put("message",record.optString("message")+" · "+failure);
    }
    static String copyFailureMessage(JSONObject copies)throws JSONException {
        JSONArray failed=copies.optJSONArray("failed");if(failed==null||failed.length()==0)return "";
        Map<String,Set<String>> groups=new LinkedHashMap<>();
        for(int i=0;i<failed.length();i++){
            JSONObject item=failed.getJSONObject(i);String label;
            switch(item.optString("kind")){
                case "transcript":label="전사문";break;
                case "summaryMd":label="요약본(.md)";break;
                case "summaryTxt":label="요약본(.txt)";break;
                case "audio":label="원음";break;
                default:label="사본";
            }
            String reason=item.optString("message").replaceFirst("\\.$","");
            if(!groups.containsKey(reason))groups.put(reason,new LinkedHashSet<>());groups.get(reason).add(label);
        }
        List<String> reasons=new ArrayList<>();for(Map.Entry<String,Set<String>> group:groups.entrySet())reasons.add(String.join("·",group.getValue())+" — "+group.getKey());
        return "고른 폴더에 저장하지 못했습니다: "+String.join(", ",reasons)+". 설정에서 폴더를 확인한 뒤 ‘고른 폴더에 다시 저장’을 누르세요.";
    }
    void analyze(JSONObject record) throws Exception {
        File dir=store.directory(Store.location(record),record.getString("id"));JSONArray audio=record.getJSONArray("audio");StringBuilder transcript=new StringBuilder();
        for(int i=0;i<audio.length();i++){
            check();progress.update("음성을 글로 변환 중 · "+(i+1)+" / "+audio.length());File saved=new File(dir,String.format(Locale.ROOT,"전사-%03d.txt",i+1));
            String text=saved.exists()?Store.read(saved):transcribe(record,new File(dir,audio.getString(i)));
            if(!saved.exists())Store.write(saved,text);if(transcript.length()>0)transcript.append("\n\n");transcript.append(text);Store.write(new File(dir,"전사.txt"),transcript.toString());
        }
        if(transcript.toString().trim().isEmpty())throw new IOException("인식된 발언이 없습니다. 원음은 보관했습니다.");
        JSONObject previous=null;List<String> chunks=TextChunks.split(transcript.toString(),24000);
        for(int i=0;i<chunks.size();i++){progress.update(model.label+" 회의록 분석 중 · "+(i+1)+" / "+chunks.size());previous=section(record,chunks.get(i),previous,dir,0);}
        analysis(record).put("summaryModel",model.id);store.finish(record,previous,null);
    }
    JSONObject section(JSONObject record,String text,JSONObject previous,File dir,int depth) throws Exception {
        return section(record,text,previous,dir,depth,null);
    }
    JSONObject section(JSONObject record,String text,JSONObject previous,File dir,int depth,String feedback) throws Exception {
        check();JSONObject input=new JSONObject();
        if(!record.optString("notes").isEmpty())input.put("notes",record.optString("notes"));
        input.put("title",record.optString("title")).put("date",record.optString("date")).put("participants",record.optString("participants")).put("transcript",text);
        if(previous!=null)input.put("previousMinutes",previous);
        if(feedback!=null)input.put("feedback",feedback);
        String format=Store.meetingFormat(record);CustomFormat custom="custom".equals(format)?Store.custom(record):null;
        String instructions=templates.read("summary-"+(custom!=null?"meeting":format)+".json"),feedbackInstructions=feedback==null?null:templates.read("summary-feedback.json");
        String source=new JSONArray().put("summary-v2").put(input.toString()).put(model.id).put(format).put(custom==null?JSONObject.NULL:custom.json()).put(digest(instructions)).put(feedbackInstructions==null?JSONObject.NULL:digest(feedbackInstructions)).toString();
        String hash=digest(source);File cache=new File(dir,"중간요약/"+hash+".json"), split=new File(dir,"중간요약/"+hash+"-분할.json");
        // 요청 내용과 실제 자산의 지문을 함께 묶어 옛 지시문·다른 의견의 성공 결과가 섞이지 않게 한다.
        if(cache.exists())return new JSONObject(Store.read(cache));
        JSONArray parts=split.exists()?new JSONArray(Store.read(split)):null;
        if(parts==null){
            if(depth>0&&extra++>=6)throw new IOException("자동 추가 요청 6회에 도달했습니다. 다시 분석하면 성공한 구간을 재사용합니다.");
            try{JSONObject body=new JSONObject(instructions);
                // 내 형식은 회의록형 기준 바로 다음에 사용자 항목·순서·추가 지시를 넣는다. 데스크톱과 같은 위치다.
                if(custom!=null){JSONArray old=body.getJSONArray("input"),next=new JSONArray();for(int i=0;i<old.length();i++){next.put(old.get(i));if(i==0)next.put(new JSONObject().put("role","system").put("content",custom.instruction()));}body.put("input",next);}body.put("model",model.id).put("max_output_tokens",model.maxOutputTokens).put("reasoning",new JSONObject().put("effort",model.reasoningEffort));
                body.remove("temperature");body.remove("top_p");
                if(feedbackInstructions!=null)body.getJSONArray("input").put(new JSONObject(feedbackInstructions));
                body.getJSONArray("input").put(new JSONObject().put("role","user").put("content",input.toString()));
                HttpURLConnection c=connect("responses","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}catch(Exception ex){c.disconnect();throw ex;}
                JSONObject result=sent(record,c,AiUsage.SUMMARY,model.id);
                if(result.optString("status").equals("incomplete")&&result.optJSONObject("incomplete_details")!=null&&result.getJSONObject("incomplete_details").optString("reason").equals("max_output_tokens"))throw new Limit("출력 길이 한도");
                if(!result.optString("status").equals("completed"))throw new IOException("AI가 요약을 완료하지 못했습니다. 전사는 보관했습니다.");
                JSONArray output=result.getJSONArray("output");String raw=null;for(int i=0;i<output.length();i++){JSONObject item=output.getJSONObject(i);if(item.optString("type").equals("message")){JSONArray content=item.getJSONArray("content");for(int j=0;j<content.length();j++)if(content.getJSONObject(j).optString("type").equals("output_text"))raw=content.getJSONObject(j).getString("text");}}
                if(raw==null)throw new IOException("요약 응답을 읽지 못했습니다.");JSONObject minutes=new JSONObject(raw);minutes.getString("overview");minutes.getJSONArray("topics");minutes.getJSONArray("decisions");minutes.getJSONArray("actions");minutes.getJSONArray("openQuestions");Store.write(cache,minutes.toString());return minutes;
            }catch(Limit limit){if(text.length()<=2000||extra>=6)throw new IOException("길이 한도를 복구하지 못했습니다. 전사와 성공 구간은 저장되어 있습니다.");parts=new JSONArray(TextChunks.split(text,(text.length()+1)/2));Store.write(split,parts.toString());}
        }
        progress.update("길이 한도에 도달해 작은 구간으로 나눠 분석합니다.");JSONObject result=previous;
        for(int i=0;i<parts.length();i++)result=section(record,parts.getString(i),result,dir,depth+1,feedback);
        Store.write(cache,result.toString());return result;
    }
    static JSONObject analysis(JSONObject record) throws JSONException {JSONObject value=record.optJSONObject("analysis");if(value==null){value=new JSONObject();record.put("analysis",value);}return value;}
    JSONObject sent(JSONObject record,HttpURLConnection connection,String kind,String id) throws Exception {
        // 전송한 호출마다 기록한다. 응답을 못 받은 실패는 0이 아니라 미확인 건수로 남기고 원래 오류를 그대로 알린다.
        JSONObject result;
        try{result=response(connection);}catch(Exception ex){try{addUsage(record,kind,id,null);saveUsage(record);}catch(Exception ignored){}throw ex;}
        Object reported=result.opt("model");
        addUsage(record,kind,usageModel(reported instanceof String?(String)reported:null,id),result.optJSONObject("usage"));saveUsage(record);return result;
    }
    void saveUsage(JSONObject record)throws Exception {
        if(usageTarget==null)store.save(record);
        else{usageTarget.put("analysis",new JSONObject(analysis(record).toString()));store.save(usageTarget);}
    }
    static String digest(String text)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
    static String usageModel(String reported,String requested){
        // 응답이 알려준 실제 모델(스냅샷 이름 포함)을 우선 기록하고, 없거나 형식이 틀리면 요청한 모델로 기록한다.
        return AiUsage.validModel(reported)?reported:requested;
    }
    static Long count(JSONObject object,String name){
        if(object==null||!object.has(name)||object.isNull(name))return null;Object value=object.opt(name);if(!(value instanceof Number))return null;
        double number=((Number)value).doubleValue();return number>=0&&number==Math.rint(number)&&number<=9007199254740991d?(long)number:null;
    }
    static Double seconds(JSONObject object,String name){
        if(object==null||!object.has(name)||object.isNull(name))return null;Object value=object.opt(name);return value instanceof Number?((Number)value).doubleValue():null;
    }
    static void addUsage(JSONObject record,String kind,String id,JSONObject raw) throws JSONException {
        JSONObject analysis=analysis(record);JSONArray saved=analysis.optJSONArray("usage");List<AiUsage.Entry> ledger=new ArrayList<>();
        if(saved!=null)for(int i=0;i<saved.length();i++){JSONObject e=saved.optJSONObject(i);if(e==null)continue;
            AiUsage.merge(ledger,AiUsage.restore(e.has("kind")?e.optString("kind"):null,e.optString("model",null),count(e,"requests"),count(e,"measuredRequests"),count(e,"unknownRequests"),count(e,"inputTokens"),count(e,"outputTokens"),count(e,"totalTokens"),count(e,"cachedInputTokens"),count(e,"reasoningTokens"),seconds(e,"audioSeconds")));}
        AiUsage.Measured measured=null;Double audio=null;
        if(raw!=null&&"duration".equals(raw.optString("type")))audio=seconds(raw,"seconds");
        else if(raw!=null)measured=AiUsage.Measured.of(count(raw,"input_tokens"),count(raw,"output_tokens"),count(raw,"total_tokens"),count(raw.optJSONObject("input_tokens_details"),"cached_tokens"),count(raw.optJSONObject("output_tokens_details"),"reasoning_tokens"));
        AiUsage.add(ledger,kind,id,measured,audio);
        JSONArray out=new JSONArray();
        for(AiUsage.Entry e:ledger)out.put(new JSONObject().put("kind",e.kind).put("model",e.model).put("requests",e.requests).put("measuredRequests",e.measuredRequests).put("unknownRequests",e.unknownRequests)
            .put("inputTokens",e.inputTokens).put("outputTokens",e.outputTokens).put("totalTokens",e.totalTokens).put("cachedInputTokens",e.cachedInputTokens).put("reasoningTokens",e.reasoningTokens).put("audioSeconds",e.audioSeconds));
        analysis.put("usage",out);
        // 데스크톱과 같은 저장 형식으로 호출마다 새 callId를 남긴다. 휴대폰은 호출 지점에서 한 번만 기록하므로 재전송 중복이 없다.
        JSONArray ids=analysis.optJSONArray("callIds"),kept=new JSONArray();if(ids==null)ids=new JSONArray();ids.put(UUID.randomUUID().toString());
        for(int i=Math.max(0,ids.length()-1000);i<ids.length();i++)kept.put(ids.opt(i));analysis.put("callIds",kept);
    }
    static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
}
