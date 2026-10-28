// 모바일 화면을 표시하고 권한 요청 및 녹음 서비스와 파일 공유를 연결한다.
package kr.local.meetingjournal;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.view.View;
import android.widget.FrameLayout;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;

public final class MainActivity extends Activity {
    private WebView view; private Store store; private String permissionId; private JSONObject permissionInput;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private static final int EXPORT_SETTINGS=21,IMPORT_SETTINGS=22,PICK_FOLDER=23;
    private volatile String folderKind;
    // 파일 선택 창이 열린 요청, 내보낼 내용, 확인을 기다리는 불러온 설정이다. 확인 전에는 아무것도 저장하지 않는다.
    private volatile String fileRequest; private volatile byte[] exportBytes; private volatile SettingsFile.Value importPending; private volatile String importToken;
    @Override public void onCreate(Bundle state){super.onCreate(state);store=new Store(this);view=new WebView(this);FrameLayout container=new FrameLayout(this);container.addView(view,new FrameLayout.LayoutParams(-1,-1));setContentView(container);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        container.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        view.getSettings().setJavaScriptEnabled(true);view.getSettings().setAllowFileAccess(false);view.getSettings().setAllowContentAccess(false);view.getSettings().setDomStorageEnabled(false);view.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        view.addJavascriptInterface(new Bridge(),"Native");
        view.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView web,WebResourceRequest request){
                Uri uri=request.getUrl();String file=uri.getPath();
                if("app.meeting.local".equals(uri.getHost())&&("/index.html".equals(file)||"/app.js".equals(file)||"/flow.js".equals(file)||"/formats.js".equals(file)||"/app.css".equals(file))){try{return new WebResourceResponse(file.endsWith(".css")?"text/css":file.endsWith(".js")?"application/javascript":"text/html","UTF-8",getAssets().open(file.substring(1)));}catch(IOException ignored){}}
                return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }});view.loadUrl("https://app.meeting.local/index.html");
    }
    private void answer(String id,Object value,String error){runOnUiThread(()->{if(isDestroyed())return;try{JSONObject payload=new JSONObject().put("value",value==null?JSONObject.NULL:value).put("error",error==null?JSONObject.NULL:error);view.evaluateJavascript("window.receive("+JSONObject.quote(id)+","+payload.toString()+")",null);}catch(Exception ignored){}});}
    private final class Bridge {
        @JavascriptInterface public void request(String id,String method,String json){if(json.length()>100000){answer(id,null,"입력이 너무 큽니다.");return;}worker.submit(()->{try{dispatch(id,method,new JSONObject(json));}catch(Exception ex){answer(id,null,MeetingService.safeMessage(ex));}});}
    }
    private void dispatch(String id,String method,JSONObject data)throws Exception {
        String location=data.optString("location","main");
        switch(method){
            case "init":{JSONObject custom=store.customFormat();answer(id,new JSONObject().put("connection",connection()).put("settings",store.settings()).put("customFormat",custom==null?JSONObject.NULL:custom),null);break;}
            case "saveCustomFormat": settingsIdle();answer(id,store.saveCustomFormat(data.getJSONObject("customFormat")),null);break;
            case "deleteCustomFormat": settingsIdle();store.deleteCustomFormat();answer(id,JSONObject.NULL,null);break;
            case "status": answer(id,new JSONObject().put("active",MeetingService.active).put("meeting",new JSONObject(MeetingService.snapshot)).put("connection",connection()),null);break;
            case "history": answer(id,store.history(),null);break;
            case "results": answer(id,store.results(location,data.getString("id")),null);break;
            case "review":{
                settingsIdle();fileIdle();Object value=data.opt("stars");Integer stars=null;
                if(value!=null&&value!=JSONObject.NULL){if(!(value instanceof Number)||((Number)value).doubleValue()!=((Number)value).intValue())throw new IOException("별점은 1~5 정수로 입력하세요.");stars=((Number)value).intValue();}
                Object comment=data.opt("comment");if(comment!=null&&comment!=JSONObject.NULL&&!(comment instanceof String))throw new IOException("의견을 글로 입력하세요.");
                answer(id,store.saveReview(location,data.getString("id"),nullableString(data,"resultId"),stars,nullableString(data,"comment")),null);break;
            }
            case "exportSettings": settingsIdle();exportBytes=store.exportSettings();pick(id,EXPORT_SETTINGS);break;
            case "importSettings": settingsIdle();importPending=null;importToken=null;pick(id,IMPORT_SETTINGS);break;
            case "applySettings":{
                SettingsFile.Value pending=importPending;
                if(pending==null||!data.optString("token").equals(importToken))throw new IOException("불러온 설정이 없습니다. 설정 파일을 다시 선택하세요.");
                settingsIdle();importPending=null;importToken=null;
                answer(id,store.importSettings(pending).put("connection",connection()),null);break;
            }
            case "saveSettings":settingsIdle();answer(id,new JSONObject().put("settings",store.saveSettings(data)).put("connection",connection()),null);break;
            case "pickFolder":{
                fileIdle();settingsIdle();String kind=data.getString("kind");Copies.kind(kind);folderKind=kind;fileRequest=id;
                runOnUiThread(()->{try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION),PICK_FOLDER);}catch(Exception ex){fileRequest=null;folderKind=null;answer(id,null,"폴더 선택 창을 열지 못했습니다.");}});break;
            }
            case "clearFolder":settingsIdle();fileIdle();Copies.clearFolder(this,data.getString("kind"));answer(id,new JSONObject().put("settings",store.settings()),null);break;
            case "copies":{
                if(MeetingService.active)throw new IOException("녹음이나 분석이 끝난 뒤 사본을 저장할 수 있습니다.");fileIdle();answer(id,Copies.copyResult(this,store,location,data.getString("id"),nullableString(data,"resultId")),null);break;
            }
            case "cancelSettings": importPending=null;importToken=null;answer(id,true,null);break;
            case "draft": answer(id,store.draft(),null);break;
            case "saveDraft": if(!MeetingService.active&&permissionId==null)store.saveDraft(data);answer(id,true,null);break;
            case "key":
                settingsIdle();
                if(TrialAccess.isUnlockCode(data.optString("key"))){
                    try{store.trial().unlock();}catch(TrialAccess.StorageException ex){throw new IOException(ex.getMessage());}
                    answer(id,connection().put("unlockApplied",true),null);break;
                }
                store.key(data.getString("key"),data.optBoolean("persist",true));answer(id,connection(),null);break;
            case "removeKey": settingsIdle();store.removeKey();answer(id,connection(),null);break;
            case "model":{
                settingsIdle();String model=data.getString("model");
                if(AiModels.find(model)==null)throw new IOException("지원하지 않는 요약 모델입니다.");store.summaryModel(model);answer(id,connection(),null);break;
            }
            case "start":
                if(MeetingService.active)throw new IOException("이미 진행 중인 회의가 있습니다.");
                fileIdle();store.requireAccess();Store.notes(data);
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
                    permissionId=id;permissionInput=data;
                    runOnUiThread(()->requestPermissions(Build.VERSION.SDK_INT>=33?new String[]{Manifest.permission.RECORD_AUDIO,Manifest.permission.POST_NOTIFICATIONS}:new String[]{Manifest.permission.RECORD_AUDIO},12));return;}
                begin(id,data);break;
            case "finish": runOnUiThread(()->startService(new Intent(this,MeetingService.class).setAction("finish")));answer(id,true,null);break;
            case "analyze":{
                if(MeetingService.active)throw new IOException("진행 중인 회의가 있습니다.");
                fileIdle();store.requireAccess();
                String meetingId=data.getString("id");store.load(location,meetingId);launch(id,"analyze",location,meetingId);break;
            }
            case "refine":{
                if(MeetingService.active)throw new IOException("진행 중인 회의가 있습니다.");
                fileIdle();store.requireAccess();String meetingId=data.getString("id"),resultId=nullableString(data,"resultId"),feedback=Ai.checkedFeedback(data.opt("feedback"));
                JSONObject selected=store.result(location,meetingId,resultId);
                if(selected.optJSONObject("minutes")==null)throw new IOException("정리된 결과에만 의견을 반영할 수 있습니다.");
                File transcript=new File(store.directory(location,meetingId),"전사.txt");
                if(!transcript.isFile()||JsonText.trim(Store.read(transcript)).isEmpty())throw new IOException("저장된 전사가 없어 의견을 반영할 수 없습니다.");
                String attemptId=data.getString("attemptId");if(attemptId.isEmpty()||attemptId.length()>128)throw new IOException("의견 반영 시도를 확인할 수 없습니다. 다시 시도하세요.");
                Intent request=new Intent(this,MeetingService.class).setAction("refine").putExtra("location",location).putExtra("id",meetingId).putExtra("resultId",selected.getString("resultId")).putExtra("feedback",feedback).putExtra("attemptId",attemptId);
                runOnUiThread(()->{try{startForegroundService(request);answer(id,new JSONObject().put("id",meetingId).put("attemptId",attemptId),null);}catch(Exception ex){answer(id,null,"의견 반영 서비스를 시작하지 못했습니다. 다시 시도하세요.");}});break;
            }
            case "open":{
                String meetingId=data.getString("id");JSONObject record=store.result(location,meetingId,nullableString(data,"resultId"));
                File transcript=new File(store.directory(location,meetingId),"전사.txt");String resultId=record.optString("resultId",null);
                answer(id,new JSONObject().put("record",record).put("minutes",record.optJSONObject("minutes")==null?JSONObject.NULL:record.getJSONObject("minutes"))
                    .put("transcript",transcript.exists()?Store.read(transcript):"").put("resultId",resultId==null?JSONObject.NULL:resultId)
                    .put("versions",store.results(location,meetingId)).put("review",resultId==null?JSONObject.NULL:store.loadReview(location,meetingId,resultId))
                    .put("copies",resultId==null?JSONObject.NULL:Copies.status(this,store,location,meetingId,resultId)),null);break;
            }
            case "share":share(id,location,data.getString("id"),nullableString(data,"resultId"),data.optString("kind","summary"));break;
            case "copy":{
                String kind=data.optString("kind","summary"),text=resultText(location,data.getString("id"),nullableString(data,"resultId"),kind);
                if(text.length()>300000)throw new IOException("글이 너무 길어 복사할 수 없습니다. 공유를 이용하세요.");
                runOnUiThread(()->((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("transcript".equals(kind)?"전사문":"회의 정리본",text)));
                answer(id,true,null);break;
            }
            default:throw new IOException("지원하지 않는 요청입니다.");
        }
    }
    static String nullableString(JSONObject data,String key){return !data.has(key)||data.isNull(key)?null:data.optString(key,null);}
    private JSONObject connection()throws Exception {
        JSONArray models=new JSONArray();
        for(AiModels.Model model:AiModels.ALL)models.put(new JSONObject().put("id",model.id).put("label",model.label).put("description",model.description).put("maxOutputTokens",model.maxOutputTokens).put("modelMaxOutputTokens",model.modelMaxOutputTokens));
        AiModels.Model selected=AiModels.find(store.summaryModel());TrialAccess.Status trial=store.access();
        // 체험권한 상태를 키 값 없이 그대로 펼쳐 화면에 알린다. keyConfigured는 기존처럼 개인 키 등록 여부다.
        return new JSONObject().put("keyConfigured",!store.key().isEmpty()).put("keySource",store.keySource()).put("models",models).put("summaryModel",selected==null?AiModels.DEFAULT_MODEL:selected.id).put("active",MeetingService.active)
            .put("accessMode",trial.accessMode).put("trialLimit",trial.trialLimit).put("trialUsed",trial.trialUsed).put("trialRemaining",trial.trialRemaining).put("trialReserved",trial.trialReserved).put("mustRegister",trial.mustRegister).put("unlocked",trial.unlocked).put("trialError",trial.trialError);
    }
    private void fileIdle()throws IOException {if(permissionId!=null||fileRequest!=null||importPending!=null)throw new IOException("설정 파일 작업을 먼저 마치거나 취소하세요.");}
    private void settingsIdle()throws IOException {
        if(MeetingService.active)throw new IOException("녹음이나 분석이 끝난 뒤 설정 파일을 내보내거나 불러올 수 있습니다.");
        if(permissionId!=null)throw new IOException("권한 요청을 먼저 마쳐 주세요.");
        if(fileRequest!=null)throw new IOException("다른 설정 파일 작업이 진행 중입니다.");
    }
    private void pick(String id,int code){
        // 저장소 접근 프레임워크(SAF)의 문서 선택 창만 사용한다. 앱이 임의 경로에 파일을 쓰지 않는다.
        fileRequest=id;
        runOnUiThread(()->{try{
            Intent intent=new Intent(code==EXPORT_SETTINGS?Intent.ACTION_CREATE_DOCUMENT:Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
            if(code==EXPORT_SETTINGS)intent.setType("application/json").putExtra(Intent.EXTRA_TITLE,new java.text.SimpleDateFormat("yyyy-MM-dd",Locale.ROOT).format(new Date())+"-VoiceNote-설정.json");
            else intent.setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/json","text/plain","application/octet-stream"});
            startActivityForResult(intent,code);
        }catch(Exception ex){fileRequest=null;exportBytes=null;answer(id,null,"파일 선택 창을 열지 못했습니다.");}});
    }
    @Override protected void onActivityResult(int code,int result,Intent intent){
        super.onActivityResult(code,result,intent);
        if(code==PICK_FOLDER){folderResult(result,intent);return;}
        if(code!=EXPORT_SETTINGS&&code!=IMPORT_SETTINGS)return;
        String id=fileRequest;byte[] bytes=exportBytes;Uri uri=result==RESULT_OK&&intent!=null?intent.getData():null;
        if(id==null)return;
        worker.submit(()->{try{
            if(uri==null){answer(id,new JSONObject().put("cancelled",true),null);return;}
            if(!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme()))throw new IOException("문서 선택 창에서 고른 파일만 사용할 수 있습니다.");
            if(code==EXPORT_SETTINGS){
                OutputStream opened;try{opened=getContentResolver().openOutputStream(uri,"wt");}catch(FileNotFoundException|IllegalArgumentException|UnsupportedOperationException modeless){opened=getContentResolver().openOutputStream(uri,"w");}
                try(OutputStream out=opened){if(out==null)throw new IOException("선택한 위치에 쓸 수 없습니다.");out.write(bytes);}
                answer(id,new JSONObject().put("saved",true).put("file",displayName(uri)),null);
            }else{
                SettingsFile.Value value=SettingsFile.read(readLimited(uri));
                String token=UUID.randomUUID().toString();importPending=value;importToken=token;
                answer(id,preview(token,displayName(uri),value),null);
            }
        }catch(Exception ex){answer(id,null,ex instanceof IOException?ex.getMessage():"설정 파일을 처리하지 못했습니다. 기존 설정은 그대로입니다.");}
        finally{fileRequest=null;exportBytes=null;}});
    }
    private void folderResult(int result,Intent intent){
        String id=fileRequest,kind=folderKind;if(id==null||kind==null)return;Uri uri=result==RESULT_OK&&intent!=null?intent.getData():null;
        worker.submit(()->{try{
            if(uri==null){answer(id,new JSONObject().put("cancelled",true).put("settings",store.settings()),null);return;}
            int required=Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            if((intent.getFlags()&required)!=required)throw new IOException("폴더의 읽기·쓰기 권한을 받을 수 없습니다. 다른 폴더를 골라 주세요.");
            Uri tree=Copies.TreeSink.tree(uri.toString()),document=android.provider.DocumentsContract.buildDocumentUriUsingTree(tree,android.provider.DocumentsContract.getTreeDocumentId(tree));
            String name=new Copies.TreeSink(this).name(document);Copies.changeFolder(this,kind,uri.toString(),name,new Copies.TreePermissions(this));
            answer(id,new JSONObject().put("settings",store.settings()),null);
        }catch(Exception ex){answer(id,null,"저장 위치를 바꾸지 못했습니다. 폴더를 다시 골라 주세요.");}finally{fileRequest=null;folderKind=null;}});
    }
    private byte[] readLimited(Uri uri)throws IOException {
        // 128KiB를 넘는 파일은 끝까지 읽지 않고 거절한다.
        try(InputStream in=getContentResolver().openInputStream(uri)){
            if(in==null)throw new IOException("선택한 파일을 열 수 없습니다.");
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];
            for(int n;(n=in.read(b))!=-1;){out.write(b,0,n);if(out.size()>SettingsFile.MAX_BYTES)throw new IOException("설정 파일이 128KiB를 넘었습니다.");}
            return out.toByteArray();
        }
    }
    private String displayName(Uri uri){
        try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){
            if(cursor!=null&&cursor.moveToFirst())return cursor.getString(0);
        }catch(Exception ignored){}
        return "";
    }
    private JSONObject preview(String token,String file,SettingsFile.Value value)throws Exception {
        return new JSONObject().put("token",token).put("file",file).put("preview",store.settingsPreview(value));
    }
    private void begin(String id,JSONObject data)throws Exception {
        store.draft();JSONObject record=store.create(data);store.clearDraft();launch(id,"record","main",record.getString("id"));
    }
    private void launch(String id,String action,String location,String meetingId){runOnUiThread(()->{try{startForegroundService(new Intent(this,MeetingService.class).setAction(action).putExtra("location",location).putExtra("id",meetingId));answer(id,new JSONObject().put("id",meetingId),null);}catch(Exception ex){answer(id,null,"녹음 또는 분석 서비스를 시작하지 못했습니다. 마이크 권한을 확인하세요.");}});}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){super.onRequestPermissionsResult(code,permissions,results);if(code==12){String id=permissionId;JSONObject data=permissionInput;permissionId=null;permissionInput=null;if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)worker.submit(()->{try{begin(id,data);}catch(Exception ex){answer(id,null,MeetingService.safeMessage(ex));}});else answer(id,null,"녹음하려면 마이크 권한이 필요합니다.");}}
    private void share(String requestId,String location,String id,String resultId,String kind)throws Exception {
        JSONObject record=store.result(location,id,resultId);File dir=store.directory(location,id),cache=new File(getCacheDir(),"공유");cache.mkdirs();
        String title=record.optString("title").replaceAll("[<>:\"/\\\\|?*\\p{Cntrl}]","_");if(title.length()>60)title=title.substring(0,60);
        String prefix=record.getString("date")+"-"+record.getInt("dailySequence")+"차-"+title+"-"+System.currentTimeMillis();
        String document=Store.documentLabel(record).replaceAll("[<>:\"/\\\\|?*\\p{Cntrl}\\s]","")+".txt";File output;
        if("all".equals(kind)){
            output=new File(cache,prefix+".zip");try(ZipOutputStream zip=new ZipOutputStream(new FileOutputStream(output))){
                File transcript=new File(dir,"전사.txt");if(transcript.exists())zipText(zip,"전사.txt",Store.read(transcript));
                if(record.optJSONObject("minutes")!=null){zipText(zip,document,MeetingDocument.text(record,record.getJSONObject("minutes")));zipText(zip,"요약.json",record.getJSONObject("minutes").toString(2));}
                JSONArray audio=record.getJSONArray("audio");for(int i=0;i<audio.length();i++){String name=audio.getString(i);File file=new File(dir,name);if(!file.exists())continue;
                    zip.putNextEntry(new ZipEntry(name));try(InputStream in=new FileInputStream(file)){byte[] b=new byte[8192];for(int n;(n=in.read(b))!=-1;)zip.write(b,0,n);}zip.closeEntry();}
            }
        }else{output=new File(cache,prefix+"-"+("transcript".equals(kind)?"전사.txt":document));Store.write(output,resultText(location,id,resultId,kind));}
        Uri uri=new Uri.Builder().scheme("content").authority("kr.local.meetingjournal.share").appendPath(output.getName()).build();
        String body=output.getName().endsWith(".zip")?null:Store.read(output);
        runOnUiThread(()->{Intent intent=new Intent(Intent.ACTION_SEND).setType(output.getName().endsWith(".zip")?"application/zip":"text/plain").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if(body!=null&&body.length()<=50000)intent.putExtra(Intent.EXTRA_TEXT,body).putExtra(Intent.EXTRA_SUBJECT,record.optString("title"));
            intent.setClipData(ClipData.newRawUri("회의 자료",uri));startActivity(Intent.createChooser(intent,"회의 자료 공유"));});answer(requestId,true,null);
    }
    private static void zipText(ZipOutputStream zip,String name,String value)throws Exception {zip.putNextEntry(new ZipEntry(name));zip.write(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));zip.closeEntry();}
    private String resultText(String location,String id,String resultId,String kind)throws Exception {
        if("transcript".equals(kind)){File file=new File(store.directory(location,id),"전사.txt");if(!file.exists())throw new IOException("아직 저장된 전사문이 없습니다.");return Store.read(file);}
        JSONObject record=store.result(location,id,resultId);if(record.optJSONObject("minutes")==null)throw new IOException("아직 정리된 결과가 없습니다. 분석이 끝난 뒤 다시 시도하세요.");
        return MeetingDocument.text(record,record.getJSONObject("minutes"));
    }
    @Override public void onBackPressed(){view.evaluateJavascript("!!(window.handleBack&&window.handleBack())",handled->{if(!"true".equals(handled)&&!isFinishing())super.onBackPressed();});}
    @Override public void onDestroy(){view.removeJavascriptInterface("Native");view.destroy();worker.shutdown();super.onDestroy();}
}
