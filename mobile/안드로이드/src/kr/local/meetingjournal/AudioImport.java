// 다른 앱이 만든 녹음 파일을 불러올 때의 판정 규칙(m4a 머리, 나눌지, 조각 경계, 공간)과 안내 문구를 둔다.
package kr.local.meetingjournal;
import android.content.ContentResolver;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.provider.OpenableColumns;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class AudioImport {
    static final long COPY_MAX_US=1_200_000_000L,COPY_MAX_BYTES=23_068_672L;
    // 앱 녹음(MeetingService)과 같은 기준이다. 둘 다 안이면 원본을 그대로 담고, 넘으면 다시 압축하지 않고 잘라 담는다.
    static final long PART_MAX_US=1_200_000_000L,PART_TARGET_BYTES=20_971_520L;
    // 조각은 20분이나 22MB 상한 아래 여유를 둔 20MiB 중 먼저 닿는 곳에서 끊는다.
    static final long FILE_MAX_US=14_400_000_000L,SPACE_MARGIN_BYTES=52_428_800L;
    // 녹음 서비스의 화면 꺼짐 방지가 4시간이라 그보다 긴 파일은 받지 않는다. 담을 공간은 파일 크기에 50MiB 여유를 더해 본다.
    static final String AAC="audio/mp4a-latm";
    static final String NO_SPACE="휴대폰 저장 공간이 부족해 파일을 불러오지 못했습니다.";
    static final String UNREADABLE="파일을 읽지 못했습니다. 다시 골라 주세요.";

    private AudioImport(){}
    static boolean mp4Header(byte[] head){
        return head!=null&&head.length>=12&&"ftyp".equals(new String(head,4,4,StandardCharsets.US_ASCII));
        // MP4 계열은 첫 상자가 ftyp다. Windows 불러오기와 서버 전사 판정도 같은 조건을 본다.
    }
    static boolean needsSplit(long durationUs,long sizeBytes){return durationUs>COPY_MAX_US||sizeBytes>COPY_MAX_BYTES;}
    static boolean newPart(long partStartUs,long sampleUs,long partBytes,int sampleBytes,long maxUs,long maxBytes){
        return partBytes>0&&(sampleUs-partStartUs>=maxUs||partBytes+sampleBytes>maxBytes);
        // 아직 샘플이 없는 조각은 길이·크기와 관계없이 이 샘플부터 채운다. 샘플 하나가 상한보다 커도 빈 조각을 만들지 않는다.
    }
    static boolean enoughSpace(long usableBytes,long sizeBytes){return usableBytes>=sizeBytes+SPACE_MARGIN_BYTES;}
    static String label(String displayName){
        String name=displayName==null?"":displayName.trim();
        return name.isEmpty()?"고른 파일":name;
        // 이름을 주지 않는 문서 제공자도 있어 그때는 고른 파일이라고 부른다.
    }
    static String unsupported(String name){return "‘"+label(name)+"’ 파일은 불러올 수 없습니다. m4a 녹음 파일만 불러올 수 있습니다.";}
    static String unsplittable(String name){return "‘"+label(name)+"’ 파일은 20분(22MB)이 넘는데 나눌 수 없는 형식입니다. 20분 이하 파일만 불러올 수 있습니다.";}
    static String tooLong(String name){return "‘"+label(name)+"’ 파일은 4시간이 넘어 불러올 수 없습니다.";}

    static final class Inspection{
        final String name,mime;final long size,durationUs;final int track;final boolean split;
        // name은 안내 문구에만 쓰는 표시 이름이다. 회의 기록에는 저장하지 않는다.
        Inspection(String name,long size,long durationUs,String mime,int track,boolean split){this.name=name;this.size=size;this.durationUs=durationUs;this.mime=mime;this.track=track;this.split=split;}
    }
    static Inspection inspect(Context context,Uri uri)throws IOException{
        // 고른 문서를 읽기만 해서 받을지 정한다. 판정 순서는 머리 → 오디오 트랙 → 4시간 → 자를 수 있는지 → 공간이다.
        ContentResolver resolver=context.getContentResolver();String name=null;long size=-1;
        try(Cursor cursor=resolver.query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){
            if(cursor!=null&&cursor.moveToFirst()){if(!cursor.isNull(0))name=cursor.getString(0);if(!cursor.isNull(1))size=cursor.getLong(1);}
        }catch(RuntimeException ignored){}
        // 이름과 크기를 주지 않는 제공자도 있다(파일 주소는 query가 비어 온다). 크기는 아래에서 한 번 더 찾는다.
        byte[] head=new byte[12];int read=0;
        try(InputStream in=resolver.openInputStream(uri)){
            if(in==null)throw new IOException(UNREADABLE);
            for(int n;read<head.length&&(n=in.read(head,read,head.length-read))>0;)read+=n;
        }catch(IOException|RuntimeException ex){throw new IOException(UNREADABLE,ex);}
        if(!mp4Header(Arrays.copyOf(head,read)))throw new IOException(unsupported(name));
        if(size<0){try(AssetFileDescriptor descriptor=resolver.openAssetFileDescriptor(uri,"r")){if(descriptor!=null)size=descriptor.getLength();}catch(IOException|RuntimeException ignored){}}
        if(size<0)throw new IOException(UNREADABLE);
        // 크기를 끝내 모르면 나눌지와 공간을 정할 수 없어 읽지 못한 것으로 본다.
        MediaExtractor extractor=new MediaExtractor();
        try{
            try{extractor.setDataSource(context,uri,null);}catch(IOException|RuntimeException ex){throw new IOException(UNREADABLE,ex);}
            int track=-1;MediaFormat format=null;
            for(int i=0;i<extractor.getTrackCount();i++){MediaFormat candidate=extractor.getTrackFormat(i);String mime=candidate.getString(MediaFormat.KEY_MIME);if(mime!=null&&mime.startsWith("audio/")){track=i;format=candidate;break;}}
            if(format==null)throw new IOException(unsupported(name));
            // 영상이 든 파일도 첫 오디오 트랙만 본다.
            long duration=format.containsKey(MediaFormat.KEY_DURATION)?format.getLong(MediaFormat.KEY_DURATION):-1;
            if(duration>FILE_MAX_US)throw new IOException(tooLong(name));
            String mime=format.getString(MediaFormat.KEY_MIME);boolean split=needsSplit(duration,size);
            if(split&&!AAC.equals(mime))throw new IOException(unsplittable(name));
            if(!enoughSpace(context.getFilesDir().getUsableSpace(),size))throw new IOException(NO_SPACE);
            return new Inspection(name,size,duration,mime,track,split);
        }finally{extractor.release();}
    }
    static List<File> store(Context context,Uri uri,Inspection inspection,File dir)throws IOException{
        // 한계 안이면 원본 바이트를 그대로 원음-001.m4a로, 넘으면 다시 압축하지 않고 조각으로 담는다.
        if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException(UNREADABLE);
        if(inspection.split){
            MediaExtractor extractor=new MediaExtractor();
            try{
                try{extractor.setDataSource(context,uri,null);}catch(IOException|RuntimeException ex){throw new IOException(UNREADABLE,ex);}
                return split(extractor,inspection.track,dir,PART_MAX_US,PART_TARGET_BYTES);
            }catch(IOException ex){throw failure(context,ex);}finally{extractor.release();}
        }
        File file=new File(dir,"원음-001.m4a");
        try(InputStream in=context.getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(file)){
            if(in==null)throw new IOException(UNREADABLE);
            byte[] buffer=new byte[65536];for(int n;(n=in.read(buffer))!=-1;)out.write(buffer,0,n);
        }catch(IOException|RuntimeException ex){file.delete();throw failure(context,ex);}
        return Collections.singletonList(file);
    }
    static List<File> split(MediaExtractor extractor,int track,File dir,long maxUs,long maxBytes)throws IOException{
        // 고른 트랙의 샘플을 차례로 새 MPEG-4 조각에 옮긴다. 조각마다 시간은 0부터 다시 센다. 실패하면 만든 조각을 지운다.
        if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException(UNREADABLE);
        List<File> parts=new ArrayList<>();MediaMuxer muxer=null;
        try{
            extractor.selectTrack(track);MediaFormat format=extractor.getTrackFormat(track);
            ByteBuffer buffer=ByteBuffer.allocate(format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)?format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE):1<<20);
            MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();int out=-1;long partStart=0,partBytes=0;
            for(int size;(size=extractor.readSampleData(buffer,0))>=0;extractor.advance()){
                long time=extractor.getSampleTime();
                if(muxer==null||newPart(partStart,time,partBytes,size,maxUs,maxBytes)){
                    if(muxer!=null){muxer.stop();muxer.release();muxer=null;}
                    File part=new File(dir,String.format(Locale.ROOT,"원음-%03d.m4a",parts.size()+1));parts.add(part);
                    muxer=new MediaMuxer(part.getPath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);out=muxer.addTrack(format);muxer.start();partStart=time;partBytes=0;
                }
                info.set(0,size,time-partStart,(extractor.getSampleFlags()&MediaExtractor.SAMPLE_FLAG_SYNC)!=0?MediaCodec.BUFFER_FLAG_KEY_FRAME:0);
                muxer.writeSampleData(out,buffer,info);partBytes+=size;
            }
            if(muxer!=null){muxer.stop();muxer.release();muxer=null;}
            if(parts.isEmpty())throw new IOException(UNREADABLE);
            return parts;
        }catch(IOException|RuntimeException ex){
            if(muxer!=null)try{muxer.release();}catch(RuntimeException ignored){}
            for(File part:parts)part.delete();
            throw ex instanceof IOException?(IOException)ex:new IOException(UNREADABLE,ex);
        }
    }
    static IOException failure(Context context,Exception ex){
        // 담다가 실패하면 공간이 모자란지 보고 알맞은 안내로 바꾼다. 이미 안내 문구가 있으면 그대로 둔다.
        if(context.getFilesDir().getUsableSpace()<SPACE_MARGIN_BYTES)return new IOException(NO_SPACE,ex);
        String message=ex.getMessage();
        return message!=null&&(message.equals(UNREADABLE)||message.equals(NO_SPACE))?(ex instanceof IOException?(IOException)ex:new IOException(message,ex)):new IOException(UNREADABLE,ex);
    }
    static File tempRoot(Context context){return new File(context.getFilesDir(),"불러오기-임시");}
    static void cleanTemp(Context context){delete(tempRoot(context));}
    private static void delete(File file){File[] children=file.listFiles();if(children!=null)for(File child:children)delete(child);file.delete();}
}
