// 앱 업데이트 설치 세션의 결과를 받는다. 사람 확인이 필요하면 확인 화면을 업데이트 담당에 넘기고, 끝난 결과는 문장으로 바꿔 둔다. 오래 걸리는 일은 하지 않는다.
package kr.local.meetingjournal;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

public final class UpdateReceiver extends BroadcastReceiver {
    static final String ACTION = "kr.local.meetingjournal.UPDATE_STATUS";

    @SuppressWarnings("deprecation")
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        int id = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1);
        int result = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (result == PackageInstaller.STATUS_PENDING_USER_ACTION) Updates.pendingConfirm(id, (Intent) intent.getParcelableExtra(Intent.EXTRA_INTENT));
        else Updates.finished(id, result, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
    }
}
