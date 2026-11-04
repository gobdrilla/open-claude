; Installer hooks (bundle > windows > nsis > installerHooks).

; Migration from the old product name "Open Claude" (renamed in 1.4.0). The new product name installs into a new
; folder, and in update mode Tauri creates no shortcuts. So the old shortcuts and the old autostart entry kept
; starting the old installation, which then offered the same update again.
!define OLD_PRODUCTNAME "Open Claude"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

!macro MigrateOldShortcut dir
  ${If} ${FileExists} "${dir}\${OLD_PRODUCTNAME}.lnk"
    Delete "${dir}\${OLD_PRODUCTNAME}.lnk"
    ${IfNot} ${FileExists} "${dir}\${PRODUCTNAME}.lnk"
      CreateShortcut "${dir}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "${dir}\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro MigrateOldShortcut "$SMPROGRAMS"
  !insertmacro MigrateOldShortcut "$DESKTOP"

  ; Update mode never creates shortcuts, so a lost Start menu entry would stay lost: always make sure it exists.
  ${If} $NoShortcutMode <> 1
  ${AndIfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}

  ; A taskbar pin cannot be recreated by an installer: keep it and point it at the new executable.
  ${If} ${FileExists} "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${OLD_PRODUCTNAME}.lnk"
    !insertmacro SetShortcutTarget "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${OLD_PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  ${EndIf}

  ; Autostart (tauri-plugin-autostart names the Run value after the product name, value = "<exe> <args>").
  ReadRegStr $R9 HKCU "${RUN_KEY}" "${OLD_PRODUCTNAME}"
  ${If} $R9 != ""
    WriteRegStr HKCU "${RUN_KEY}" "${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe "
    DeleteRegValue HKCU "${RUN_KEY}" "${OLD_PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${OLD_PRODUCTNAME}"
  ${EndIf}
!macroend
