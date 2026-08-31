param([string]$op)
Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms
$q = [string][char]34; $cs = 'using System;using System.Runtime.InteropServices;public class NW{'
$cs += '[DllImport(QUuser32.dllQU)]public static extern bool SetForegroundWindow(IntPtr h);'
$cs += '[DllImport(QUuser32.dllQU)]public static extern bool ShowWindow(IntPtr h,int c);[DllImport(QUuser32.dllQU)]public static extern bool SetCursorPos(int x,int y);'
$cs += '[DllImport(QUuser32.dllQU)]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr i);[DllImport(QUuser32.dllQU)]public static extern bool SetProcessDPIAware();}'
