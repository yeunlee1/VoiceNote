// 고른 폴더에 사본을 쓰고 실제 문서 주소·이름을 기록해 중복 저장과 반쪽 파일을 막는다.
package kr.local.meetingjournal;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import org.json.*;

final class Copies {
    static final List<String> KINDS=Collections.unmodifiableList(Arrays.asList("audio","transcript","summary"));
    final Store store;final Map<String,String> folders;final Sink sink;
    Copies(Store store,Map<String,String> folders,Sink sink){this.store=store;this.folders=new HashMap<>(folders);this.sink=sink;}
    interface Permissions {void grant(String uri)throws Exception;void release(String uri);}
    static final class TreePermissions implements Permissions {
        final ContentResolver resolver;TreePermissions(Context context){resolver=context.getContentResolver();}
        public void grant(String uri){resolver.takePersistableUriPermission(Uri.parse(uri),Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}
        public void release(String uri){try{resolver.releasePersistableUriPermission(Uri.parse(uri),Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(SecurityException alreadyGone){}}
    }
    static void kind(String value)throws IOException{if(!KINDS.contains(value))throw new IOException("저장 위치 종류를 확인하세요.");}
    static Map<String,String> folders(Context context){Map<String,String> values=new LinkedHashMap<>();SharedPreferences prefs=context.getSharedPreferences("connection",0);for(String kind:KINDS)values.put(kind,prefs.getString("storage."+kind,""));return values;}
    static JSONObject storage(Context context)throws Exception{
        SharedPreferences prefs=context.getSharedPreferences("connection",0);JSONObject value=new JSONObject();
        for(String kind:KINDS)value.put(kind,new JSONObject().put("uri",prefs.getString("storage."+kind,"")).put("name",prefs.getString("storage."+kind+".name","")));return value;
    }
    static void changeFolder(Context context,String kind,String uri,String name,Permissions permissions)throws Exception{
        kind(kind);synchronized(Store.class){
            SharedPreferences prefs=context.getSharedPreferences("connection",0);Map<String,String> before=folders(context);String old=before.get(kind),oldName=prefs.getString("storage."+kind+".name",null);
            if(!uri.isEmpty())permissions.grant(uri);
            SharedPreferences.Editor next=prefs.edit();if(uri.isEmpty())next.remove("storage."+kind).remove("storage."+kind+".name");else next.putString("storage."+kind,uri).putString("storage."+kind+".name",name);
            if(!next.commit()){
                SharedPreferences.Editor restore=prefs.edit();if(old.isEmpty())restore.remove("storage."+kind);else restore.putString("storage."+kind,old);if(oldName==null)restore.remove("storage."+kind+".name");else restore.putString("storage."+kind+".name",oldName);restore.commit();
                if(!uri.isEmpty()&&!before.containsValue(uri))permissions.release(uri);throw new IOException("저장 위치를 저장하지 못했습니다. 이전 위치를 유지했습니다.");
            }
            if(!old.isEmpty()&&!folders(context).containsValue(old))permissions.release(old);
        }
    }
    static void clearFolder(Context context,String kind)throws Exception{changeFolder(context,kind,"","",new TreePermissions(context));}
    interface Source {InputStream open()throws Exception;}
    interface Sink {
        Created write(String folder,String name,String mime,Source source)throws Exception;
        boolean exists(String uri)throws Exception;
    }
    static final class Created {final String uri,name;Created(String uri,String name){this.uri=uri;this.name=name;}}
    static String safeTitle(String title){
        String value=title==null?"":title.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]","_").replaceAll("[. ]+$","");
        StringBuilder out=new StringBuilder();int bytes=0,count=0;
        for(int offset=0;offset<value.length();){int point=value.codePointAt(offset);String part=new String(Character.toChars(point));int length=part.getBytes(StandardCharsets.UTF_8).length;
            if(count>=80||bytes+length>120)break;out.append(part);bytes+=length;count++;offset+=Character.charCount(point);}
        return out.length()==0?"회의":out.toString();
    }
    static void checkName(String name)throws IOException{
        if(name==null||name.isEmpty()||name.equals(".")||name.equals("..")||java.util.regex.Pattern.compile("[<>:\"/\\\\|?*\\x00-\\x1f]").matcher(name).find()||name.getBytes(StandardCharsets.UTF_8).length>240)throw new IOException("사본 파일 이름을 확인하세요.");
    }
    static String numbered(String name,int number){int dot=name.lastIndexOf('.');String stem=dot>0?name.substring(0,dot):name,extension=dot>0?name.substring(dot):"";return number==1?name:stem+" ("+number+")"+extension;}
    static void transfer(InputStream in,OutputStream out)throws Exception {if(in==null)throw new IOException("앱에 보관된 파일을 읽지 못했습니다.");byte[] bytes=new byte[8192];for(int n;(n=in.read(bytes))!=-1;)out.write(bytes,0,n);}
    static final class FileSink implements Sink {
        public Created write(String folder,String name,String mime,Source source)throws Exception{
            checkName(name);File directory=new File(URI.create(folder));if(!directory.isDirectory())throw new FileNotFoundException("고른 폴더를 찾을 수 없습니다.");
            for(int number=1;number>0;number++){
                File file=new File(directory,numbered(name,number));OutputStream stream;
                try{stream=Files.newOutputStream(file.toPath(),StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);}catch(FileAlreadyExistsException collision){continue;}
                try(OutputStream out=stream;InputStream in=source.open()){transfer(in,out);}
                catch(Exception ex){try{Files.deleteIfExists(file.toPath());}catch(Exception cleanup){ex.addSuppressed(cleanup);}throw ex;}
                return new Created(file.toURI().toString(),file.getName());
            }throw new IOException("빈 사본 파일 이름을 찾지 못했습니다.");
        }
        public boolean exists(String uri)throws Exception{try(InputStream in=Files.newInputStream(Paths.get(URI.create(uri)))){return true;}catch(FileNotFoundException|NoSuchFileException absent){return false;}}
    }
    static final class FolderUnavailable extends IOException {
        FolderUnavailable(){super("고른 폴더를 찾을 수 없거나 권한이 끊겨 다시 골라야 합니다");}
    }
    static final class TreeSink implements Sink {
        final ContentResolver resolver;TreeSink(Context context){resolver=context.getContentResolver();}
        static Uri tree(String value)throws IOException{Uri uri=Uri.parse(value);if(!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())||!DocumentsContract.isTreeUri(uri))throw new IOException("문서 선택 창에서 폴더를 다시 골라 주세요.");return uri;}
        Set<String> names(Uri tree)throws Exception {
            Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            try(Cursor folder=resolver.query(parent,new String[]{DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){
                if(folder==null||!folder.moveToFirst()||!DocumentsContract.Document.MIME_TYPE_DIR.equals(folder.getString(0)))throw new FolderUnavailable();
            }
            Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));Set<String> names=new HashSet<>();
            try(Cursor cursor=resolver.query(children,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(cursor==null)throw new FolderUnavailable();while(cursor.moveToNext())names.add(cursor.getString(0));}return names;
        }
        String name(Uri document)throws Exception {
            try(Cursor cursor=resolver.query(document,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(cursor==null||!cursor.moveToFirst())throw new IOException("만든 사본 이름을 읽지 못했습니다.");String name=cursor.getString(0);if(name==null||name.isEmpty())throw new IOException("만든 사본 이름을 읽지 못했습니다.");return name;}
        }
        public Created write(String folder,String name,String mime,Source source)throws Exception{
            checkName(name);Uri tree=tree(folder),parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));Set<String> existing=names(tree);int number=1;while(existing.contains(numbered(name,number)))number++;
            Uri document=DocumentsContract.createDocument(resolver,parent,mime,numbered(name,number));if(document==null)throw new IOException("사본 파일을 만들지 못했습니다.");
            try{
                String actual=name(document);try(OutputStream out=resolver.openOutputStream(document,"wt");InputStream in=source.open()){if(out==null)throw new IOException("사본 파일을 열지 못했습니다.");transfer(in,out);}return new Created(document.toString(),actual);
            }catch(Exception ex){try{if(!DocumentsContract.deleteDocument(resolver,document))ex.addSuppressed(new IOException("만들던 문서를 지우지 못했습니다."));}catch(Exception cleanup){ex.addSuppressed(cleanup);}throw ex;}
        }
        public boolean exists(String value)throws Exception{Uri uri=Uri.parse(value);if(!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme()))return false;try(ParcelFileDescriptor fd=resolver.openFileDescriptor(uri,"r")){return fd!=null;}catch(FileNotFoundException absent){return false;}}
    }
    static String error(Exception ex){
        if(ex.getSuppressed().length>0)return "사본 쓰기를 마치지 못했고 만들던 파일도 지우지 못했습니다.";
        if(ex instanceof FolderUnavailable)return ex.getMessage();
        if(ex instanceof SecurityException||ex instanceof AccessDeniedException)return "고른 폴더를 찾을 수 없거나 권한이 끊겨 다시 골라야 합니다";
        if(ex instanceof FileNotFoundException)return "고른 폴더나 파일을 찾을 수 없습니다.";
        return "파일을 쓰지 못했습니다.";
    }
    static String prefix(JSONObject record,String resultId)throws Exception{
        String date=record.optString("date");if(!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))date="날짜미입력";
        return date+"-"+String.format(Locale.ROOT,"%02d",record.optInt("dailySequence",1))+"차-"+safeTitle(record.optString("title"))+"-"+resultId;
    }
    static JSONArray log(File file){try{JSONObject value=new JSONObject(Store.read(file));if(value.optInt("version")==1&&value.optJSONArray("items")!=null)return value.getJSONArray("items");}catch(Exception unreadable){}return new JSONArray();}
    static JSONObject report()throws Exception{return new JSONObject().put("ok",true).put("written",new JSONArray()).put("skipped",new JSONArray()).put("failed",new JSONArray());}
    static boolean match(JSONObject entry,String key,Object value,String folder){return entry!=null&&String.valueOf(value).equals(String.valueOf(entry.opt(key)))&&folder.equals(entry.optString("folder"));}
    static Source text(String value){return ()->new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));}
    static Source file(File file){return ()->new FileInputStream(file);}
    JSONArray attempt(JSONObject report,JSONArray items,File log,String kind,String key,Object value,String folder,String name,String mime,Source source)throws Exception{
        if(folder==null||folder.isEmpty()){report.getJSONArray("skipped").put(new JSONObject().put("kind",kind).put("reason","설정에서 저장 위치를 고르지 않았습니다."));return items;}
        JSONObject previousSuccess=null;
        for(int i=0;i<items.length();i++){JSONObject item=items.optJSONObject(i);if(match(item,key,value,folder)&&item.optBoolean("ok")){
            previousSuccess=item;
            try{if(sink.exists(item.optString("uri"))){report.getJSONArray("skipped").put(new JSONObject().put("kind",kind).put("reason","이미 이 폴더에 저장했습니다."));return items;}}catch(Exception inaccessible){}
        }}
        JSONObject entry=new JSONObject().put(key,value).put("folder",folder).put("uri","").put("name",name).put("ok",false);
        try{Created saved=sink.write(folder,name,mime,source);entry.put("uri",saved.uri).put("name",saved.name).put("ok",true);report.getJSONArray("written").put(new JSONObject().put("kind",kind).put("uri",saved.uri).put("name",saved.name));}
        catch(Exception ex){String message=error(ex);entry.put("message",message);report.getJSONArray("failed").put(new JSONObject().put("kind",kind).put("message",message));}
        if(!entry.optBoolean("ok")&&previousSuccess!=null)entry=previousSuccess;
        JSONArray next=new JSONArray();for(int i=0;i<items.length();i++){JSONObject item=items.optJSONObject(i);if(item!=null&&!match(item,key,value,folder))next.put(item);}next.put(entry);
        try{Store.write(log,new JSONObject().put("version",1).put("items",next).toString(2));}catch(Exception ex){report.getJSONArray("failed").put(new JSONObject().put("kind",kind).put("message","사본 저장 기록을 남기지 못했습니다"));}
        return next;
    }
    JSONObject copyResult(String location,String id,String resultId)throws Exception{
        synchronized(Store.class){
            JSONObject record=store.result(location,id,resultId),minutes=record.optJSONObject("minutes");if(minutes==null)throw new IOException("정리된 결과에만 사본을 저장할 수 있습니다.");String selected=record.getString("resultId");File dir=store.directory(location,id),resultLog=new File(dir,"사본기록-"+selected+".json");JSONArray items=log(resultLog);JSONObject report=report();String prefix=prefix(record,selected);
            items=attempt(report,items,resultLog,"transcript","kind","transcript",folders.get("transcript"),prefix+"-전사.txt","text/plain",file(new File(dir,"전사.txt")));
            items=attempt(report,items,resultLog,"summaryMd","kind","summaryMd",folders.get("summary"),prefix+"-요약.md","text/markdown",text(MeetingDocument.markdown(record,minutes)));
            items=attempt(report,items,resultLog,"summaryTxt","kind","summaryTxt",folders.get("summary"),prefix+"-요약.txt","text/plain",text(MeetingDocument.text(record,minutes)));
            File audioLog=new File(dir,"사본기록-원음.json");JSONArray audioItems=log(audioLog),audio=record.optJSONArray("audio");
            if(audio!=null)for(int i=0;i<audio.length();i++){
                File source=new File(dir,audio.getString(i));if(!dir.getCanonicalFile().equals(source.getCanonicalFile().getParentFile())){report.getJSONArray("failed").put(new JSONObject().put("kind","audio").put("message","원음 파일 위치를 확인하세요."));continue;}
                audioItems=attempt(report,audioItems,audioLog,"audio","index",i+1,folders.get("audio"),prefix(record,id.substring(0,8))+"-원음-"+String.format(Locale.ROOT,"%02d",i+1)+".m4a","audio/mp4",file(source));
            }
            return report.put("ok",report.getJSONArray("failed").length()==0);
        }
    }
    static JSONObject copyResult(Context context,Store store,String location,String id,String resultId)throws Exception{return new Copies(store,folders(context),new TreeSink(context)).copyResult(location,id,resultId);}
    void statusItem(JSONObject report,JSONArray entries,String key,Object value,String folder,String kind)throws Exception{
        if(folder==null||folder.isEmpty()){report.getJSONArray("skipped").put(new JSONObject().put("kind",kind).put("reason","설정에서 저장 위치를 고르지 않았습니다."));return;}
        for(int i=0;i<entries.length();i++){JSONObject item=entries.optJSONObject(i);if(!match(item,key,value,folder))continue;
            String message=item.optString("message","파일을 쓰지 못했습니다.");boolean exists=false,inaccessible=false;try{exists=item.optBoolean("ok")&&sink.exists(item.optString("uri"));}catch(Exception ex){message=error(ex);inaccessible=true;}
            if(exists)report.getJSONArray("written").put(new JSONObject().put("kind",kind).put("uri",item.optString("uri")).put("name",item.optString("name")));
            else report.getJSONArray("failed").put(new JSONObject().put("kind",kind).put("message",item.optBoolean("ok")&&!inaccessible?"저장했던 사본을 찾을 수 없습니다":message));return;
        }
    }
    JSONObject status(String location,String id,String resultId)throws Exception{
        JSONObject record=store.result(location,id,resultId),report=report();if(record.optJSONObject("minutes")==null)return report;
        File dir=store.directory(location,id);JSONArray entries=log(new File(dir,"사본기록-"+record.getString("resultId")+".json"));
        statusItem(report,entries,"kind","transcript",folders.get("transcript"),"transcript");statusItem(report,entries,"kind","summaryMd",folders.get("summary"),"summaryMd");statusItem(report,entries,"kind","summaryTxt",folders.get("summary"),"summaryTxt");
        JSONArray audio=record.optJSONArray("audio"),audioItems=log(new File(dir,"사본기록-원음.json"));if(audio!=null)for(int i=0;i<audio.length();i++)statusItem(report,audioItems,"index",i+1,folders.get("audio"),"audio");
        return report.put("ok",report.getJSONArray("failed").length()==0);
    }
    static JSONObject status(Context context,Store store,String location,String id,String resultId)throws Exception{return new Copies(store,folders(context),new TreeSink(context)).status(location,id,resultId);}
}
