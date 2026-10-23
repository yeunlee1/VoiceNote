// 사용자가 선택한 회의 내보내기 파일만 다른 앱에 읽기 권한으로 제공한다.
package kr.local.meetingjournal;
import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
public final class ShareProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    private File file(Uri uri) throws FileNotFoundException {try{File root=new File(getContext().getCacheDir(),"공유").getCanonicalFile();File file=new File(root,uri.getLastPathSegment()).getCanonicalFile();if(!file.getParentFile().equals(root)||!file.isFile())throw new FileNotFoundException();return file;}catch(IOException ex){throw new FileNotFoundException();}}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException {if(!"r".equals(mode))throw new FileNotFoundException();return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
    @Override public String getType(Uri uri){return uri.getLastPathSegment().endsWith(".zip")?"application/zip":"text/plain";}
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){try{File file=file(uri);MatrixCursor cursor=new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE});cursor.addRow(new Object[]{file.getName(),file.length()});return cursor;}catch(Exception ex){return null;}}
    @Override public Uri insert(Uri uri,ContentValues value){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues value,String selection,String[] args){throw new UnsupportedOperationException();}
}
