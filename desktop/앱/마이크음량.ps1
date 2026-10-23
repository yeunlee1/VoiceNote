# Windows 기본 입력 마이크의 음량과 음소거 상태를 조회하거나 100%로 설정한다.
param([switch]$Inspect)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class MeetingMicrophone {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class Enumerator { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDevices {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
        [PreserveSig] int OpenPropertyStore(uint access, out IProperties properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid format; public uint id; }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct Variant {
        [FieldOffset(0)] public ushort type;
        [FieldOffset(8)] public IntPtr text;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IProperties {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out Variant value);
    }
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
    [DllImport("ole32.dll")] private static extern int PropVariantClear(ref Variant value);
    public class Result {
        public string name;
        public int volume;
        public bool muted;
        public int previousVolume;
        public bool previousMuted;
    }
    private static void Check(int result) { Marshal.ThrowExceptionForHR(result); }
    public static Result Run(bool inspect) {
        IDevices devices = null;
        IDevice device = null;
        IProperties properties = null;
        object volumeObject = null;
        try {
            devices = (IDevices)new Enumerator();
            int result = devices.GetDefaultAudioEndpoint(1, 0, out device);
            if (result == unchecked((int)0x80070490))
                throw new InvalidOperationException("사용 가능한 기본 마이크가 없습니다. 마이크를 연결하고 Windows 소리 설정에서 기본 입력 장치를 선택하세요.");
            Check(result);
            Check(device.OpenPropertyStore(0, out properties));
            var key = new PropertyKey { format = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), id = 14 };
            Variant value;
            Check(properties.GetValue(ref key, out value));
            string name;
            try { name = value.type == 31 ? Marshal.PtrToStringUni(value.text) : "Windows 기본 마이크"; }
            finally { PropVariantClear(ref value); }
            Guid iid = typeof(IVolume).GUID;
            Check(device.Activate(ref iid, 23, IntPtr.Zero, out volumeObject));
            var volume = (IVolume)volumeObject;
            float before;
            bool beforeMuted;
            Check(volume.GetMasterVolumeLevelScalar(out before));
            Check(volume.GetMute(out beforeMuted));
            if (!inspect) {
                Guid context = Guid.Empty;
                Check(volume.SetMasterVolumeLevelScalar(1.0f, ref context));
                Check(volume.SetMute(false, ref context));
            }
            float after;
            bool muted;
            Check(volume.GetMasterVolumeLevelScalar(out after));
            Check(volume.GetMute(out muted));
            if (!inspect && (after < 0.9999f || muted))
                throw new InvalidOperationException("마이크 음량 100%와 음소거 해제를 확인하지 못했습니다. Windows 소리 설정을 확인하세요.");
            return new Result { name = name, volume = (int)Math.Round(after * 100), muted = muted,
                previousVolume = (int)Math.Round(before * 100), previousMuted = beforeMuted };
        } finally {
            if (volumeObject != null) Marshal.ReleaseComObject(volumeObject);
            if (properties != null) Marshal.ReleaseComObject(properties);
            if (device != null) Marshal.ReleaseComObject(device);
            if (devices != null) Marshal.ReleaseComObject(devices);
        }
    }
}
'@
    $result = [MeetingMicrophone]::Run($Inspect.IsPresent)
    $result | ConvertTo-Json -Compress
} catch {
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    @{ error = $cause.Message } | ConvertTo-Json -Compress
    exit 1
}
