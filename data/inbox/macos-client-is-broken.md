.build/debug/KotaMenuBar
*** Terminating app due to uncaught exception 'NSInternalInconsistencyException', reason: 'bundleProxyForCurrentProcess is nil: mainBundle.bundleURL file:///Users/xmanatee/Desktop/mono/apps/kota/clients/macos/.build/debug/'
*** First throw call stack:
(
	0   CoreFoundation                      0x00000001998058ec __exceptionPreprocess + 176
	1   libobjc.A.dylib                     0x00000001992de418 objc_exception_throw + 88
	2   Foundation                          0x000000019b951284 _userInfoForFileAndLine + 0
	3   UserNotifications                   0x00000001a8f122bc __53+[UNUserNotificationCenter currentNotificationCenter]_block_invoke.cold.2 + 116
	4   UserNotifications                   0x00000001a8ede4d8 __53+[UNUserNotificationCenter currentNotificationCenter]_block_invoke + 472
	5   libdispatch.dylib                   0x0000000199576ad4 _dispatch_client_callout + 16
	6   libdispatch.dylib                   0x000000019955fa60 _dispatch_once_callout + 32
	7   UserNotifications                   0x00000001a8ede2fc +[UNUserNotificationCenter currentNotificationCenter] + 156
	8   KotaMenuBar                         0x0000000102c873ec $s11KotaMenuBar19NotificationManagerCACycfc + 80
	9   KotaMenuBar                         0x0000000102c874c8 $s11KotaMenuBar19NotificationManagerCACycfcTo + 20
	10  KotaMenuBar                         0x0000000102c87298 $s11KotaMenuBar19NotificationManagerCACycfC + 28
	11  KotaMenuBar                         0x0000000102c87244 $s11KotaMenuBar19NotificationManagerC6shared_WZ + 28
	12  libdispatch.dylib                   0x0000000199576ad4 _dispatch_client_callout + 16
	13  libdispatch.dylib                   0x000000019955fa60 _dispatch_once_callout + 32
	14  KotaMenuBar                         0x0000000102c872ec $s11KotaMenuBar19NotificationManagerC6sharedACvau + 76
	15  KotaMenuBar                         0x0000000102bf5c58 $s11KotaMenuBar8AppStateCACycfc + 3784
	16  KotaMenuBar                         0x0000000102bf4d84 $s11KotaMenuBar8AppStateCACycfC + 44
	17  KotaMenuBar                         0x0000000102c27760 $s11KotaMenuBar0abC3AppV9_appState33_41B38097E3E9431C2E2D25188883F127LL7SwiftUI0F6ObjectVyAA0dF0CGvpfiAJycfu_AJycfu0_ + 28
	18  SwiftUICore                         0x00000002456c4ed4 $s7SwiftUI11StateObjectV3Box33_BDD24532CFCFEBA7264ABA5DE20A4002LLV6update8property5phaseSbACyxGz_AA12_GraphInputsV5PhaseVtF + 452
	19  SwiftUICore                         0x00000002450c7380 $s7SwiftUI9BoxVTable33_F3A89CF4357225EF49A7DD673FDFEE02LLC6update3elt8property5phaseSbAA34_UnsafeHeterogeneousBuffer_ElementV_SvAA12_GraphInputsV5PhaseVtFZ + 140
	20  SwiftUICore                         0x00000002450c61cc $s7SwiftUI22_DynamicPropertyBufferV6update9container5phaseSbSv_AA12_GraphInputsV5PhaseVtF + 144
	21  SwiftUICore                         0x000000024517d0b0 $s7SwiftUI11DynamicBody33_A4C1D658B3717A3062FEFC91A812D6EBLLV11updateValueyyFyyXEfU_ySpy9ContainerQzGXEfU_ + 304
	22  SwiftUICore                         0x000000024517eee0 $s7SwiftUI11DynamicBody33_A4C1D658B3717A3062FEFC91A812D6EBLLV11updateValueyyFyyXEfU_ySpy9ContainerQzGXEfU_TA + 32
	23  SwiftUICore                         0x00000002454ca0a4 $ss24withUnsafeMutablePointer2to_q0_xz_q0_SpyxGq_YKXEtq_YKs5ErrorR_Ri_zRi_0_r1_lF + 160
	24  SwiftUICore                         0x000000024517caa8 $s7SwiftUI11DynamicBody33_A4C1D658B3717A3062FEFC91A812D6EBLLV11updateValueyyFyyXEfU_ + 204
	25  SwiftUICore                         0x000000024517c620 $s7SwiftUI11DynamicBody33_A4C1D658B3717A3062FEFC91A812D6EBLLV11updateValueyyF + 1184
	26  SwiftUICore                         0x0000000244e77998 $s14AttributeGraph0A0VyACyxGqd__c5ValueQyd__RszAA12StatefulRuleRd__lufcADSPyqd__GXEfU_ySv_So11AGAttributeatcyXEfU_ySv_AJtcfu_TA + 32
	27  AttributeGraph                      0x00000001cee51554 _ZN2AG5Graph11UpdateStack6updateEv + 500
	28  AttributeGraph                      0x00000001cee51cf4 _ZN2AG5Graph16update_attributeENS_4data3ptrINS_4NodeEEEj + 352
	29  AttributeGraph                      0x00000001cee592bc _ZN2AG5Graph9value_refENS_11AttributeIDEjPK15AGSwiftMetadataRh + 296
	30  AttributeGraph                      0x00000001cee72718 AGGraphGetValue + 312
	31  SwiftUI                             0x00000001ce633c80 $s7SwiftUI25MenuBarExtraStyleModifierV11_makeInputs8modifier6inputsyAA11_GraphValueVyACyxGG_AA01_lI0VztFZ + 248
	32  SwiftUI                             0x00000001cde40eb0 $s7SwiftUI14_SceneModifierPA2A012_GraphInputsD0Rzs5NeverO4BodyACRtzrlE05_makeC08modifier6inputs4bodyAA01_C7OutputsVAA01_E5ValueVyxG_AA01_cF0VAnA01_E0V_AStctFZ + 320
	33  SwiftUI                             0x00000001cde41ae0 $s7SwiftUI15ModifiedContentVA2A5SceneRzAA01_E8ModifierR_rlE05_makeE05scene6inputsAA01_E7OutputsVAA11_GraphValueVyACyxq_GG_AA01_E6InputsVtFZ + 544
	34  SwiftUI                             0x00000001ce424a90 $s7SwiftUI11_TupleSceneV8MakeList33_3C80F7DE1FFF0C22DF7A3A1B806A69D8LLV5visit4typeyqd__m_tAA0D0Rd__lF + 444
	35  SwiftUI                             0x00000001ce60deb4 $s7SwiftUI15TypeConformanceVA2A15SceneDescriptorVRszrlE05visitC07visitorySpyqd__G_tAA0eC7VisitorRd__lF + 120
	36  SwiftUI                             0x00000001ce424424 $s7SwiftUI11_TupleSceneV05_makeD05scene6inputsAA01_D7OutputsVAA11_GraphValueVyACyxGG_AA01_D6InputsVtFZ + 1596
	37  SwiftUI                             0x00000001ceb80e10 $s7SwiftUI8AppGraphC3appACx_tcAA0C0RzlufcAA13_SceneOutputsVAA01_F6InputsVcfU_ + 952
	38  SwiftUI                             0x00000001ceb815a4 $s7SwiftUI8AppGraphC18instantiateOutputsyyFAA06_SceneF0VyXEfU_ + 952
	39  SwiftUI                             0x00000001ceb80ffc $s7SwiftUI8AppGraphC18instantiateOutputsyyF + 380
	40  SwiftUICore                         0x00000002454025ac $s7SwiftUI9GraphHostC11instantiateyyF + 380
	41  SwiftUI                             0x00000001cdbc7ca4 $s7SwiftUI6runAppys5NeverOxAA0D0RzlFAA0D8DelegateCyXEfU_AGyXEfU_ + 80
	42  SwiftUICore                         0x0000000245180474 $s7SwiftUI6UpdateO19dispatchImmediately6reason_xAA16CustomEventTraceV06ActionH4TypeO6ReasonOSg_xyXEtlFZ + 308
	43  SwiftUI                             0x00000001cdbc7c30 $s7SwiftUI6runAppys5NeverOxAA0D0RzlFAA0D8DelegateCyXEfU_ + 236
	44  SwiftUI                             0x00000001cdbc7b2c $s7SwiftUI6runAppys5NeverOxAA0D0RzlF + 92
	45  SwiftUI                             0x00000001cde921d8 $s7SwiftUI3AppPAAE4mainyyFZ + 224
	46  KotaMenuBar                         0x0000000102c28b60 $s11KotaMenuBar0abC3AppV5$mainyyFZ + 40
	47  KotaMenuBar                         0x0000000102c2f1ec KotaMenuBar_main + 12
	48  dyld                                0x0000000199351d54 start + 7184
)
libc++abi: terminating due to uncaught exception of type NSException

💣 Program crashed: Aborted at 0x00000001996df5b0

Platform: arm64 macOS 26.2 (25C56)

Thread 0 crashed:

  0 0x00000001996df5b0 __pthread_kill + 8 in libsystem_kernel.dylib
  1 0x000000019961e850 abort + 124 in libsystem_c.dylib
  2 0x00000001996cd858 __abort_message + 132 in libc++abi.dylib
  3 0x00000001996bc4d4 demangling_terminate_handler() + 304 in libc++abi.dylib
  4 0x00000001992e8414 _objc_terminate() + 156 in libobjc.A.dylib
  5 0x00000001996ccc2c std::__terminate(void (*)()) + 16 in libc++abi.dylib
  6 0x00000001996d0394 __cxxabiv1::failed_throw(__cxxabiv1::__cxa_exception*) + 88 in libc++abi.dylib
  7 0x00000001996d033c __cxa_throw + 92 in libc++abi.dylib
  8 0x00000001992de580 objc_exception_throw + 448 in libobjc.A.dylib
  9 0x000000019b951284 -[NSAssertionHandler handleFailureInMethod:object:file:lineNumber:description:] + 288 in Foundation
 10 0x00000001a8f122bc __53+[UNUserNotificationCenter currentNotificationCenter]_block_invoke.cold.2 + 116 in UserNotifications
 11 0x00000001a8ede4d8 __53+[UNUserNotificationCenter currentNotificationCenter]_block_invoke + 472 in UserNotifications
 12 0x0000000199576ad4 _dispatch_client_callout + 16 in libdispatch.dylib
 13 0x000000019955fa60 _dispatch_once_callout + 32 in libdispatch.dylib
 14 0x00000001a8ede2fc +[UNUserNotificationCenter currentNotificationCenter] + 156 in UserNotifications
 15 NotificationManager.init() + 80 in KotaMenuBar at /Users/xmanatee/Desktop/mono/apps/kota/clients/macos/Sources/KotaMenuBar/NotificationManager.swift:7:51

     5│     static let shared = NotificationManager()
     6│ 
     7│     private let center = UNUserNotificationCenter.current()                                                    
      │                                                   ▲
     8│ 
     9│     override init() {

 16 one-time initialization function for shared + 28 in KotaMenuBar at /Users/xmanatee/Desktop/mono/apps/kota/clients/macos/Sources/KotaMenuBar/NotificationManager.swift:5:25

     3│ 
     4│ final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
     5│     static let shared = NotificationManager()                                                                  
      │                         ▲
     6│ 
     7│     private let center = UNUserNotificationCenter.current()

 17 0x0000000199576ad4 _dispatch_client_callout + 16 in libdispatch.dylib
 18 0x000000019955fa60 _dispatch_once_callout + 32 in libdispatch.dylib
 19 NotificationManager.shared.unsafeMutableAddressor + 76 in KotaMenuBar at /Users/xmanatee/Desktop/mono/apps/kota/clients/macos/Sources/KotaMenuBar/NotificationManager.swift:5:16

     3│ 
     4│ final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
     5│     static let shared = NotificationManager()                                                                  
      │                ▲
     6│ 
     7│     private let center = UNUserNotificationCenter.current()

 20 AppState.init() + 3784 in KotaMenuBar at /Users/xmanatee/Desktop/mono/apps/kota/clients/macos/Sources/KotaMenuBar/AppState.swift:98:29

    96│         }
    97│         remoteURL = UserDefaults.standard.string(forKey: "remoteDaemonURL") ?? ""
    98│         NotificationManager.shared.requestAuthorization()                                                      
      │                             ▲
    99│         startPolling()
   100│     }

 21 0x00000002456c4ed4 StateObject.Box.update(property:phase:) + 452 in SwiftUICore
 22 0x00000002450c7380 static BoxVTable.update(elt:property:phase:) + 140 in SwiftUICore
 23 0x00000002450c61cc _DynamicPropertyBuffer.update(container:phase:) + 144 in SwiftUICore
 24 0x000000024517d0b0 closure #1 in closure #1 in DynamicBody.updateValue() + 304 in SwiftUICore
 25 0x00000002454ca0a4 withUnsafeMutablePointer<A, B, C>(to:_:) + 160 in SwiftUICore
 26 0x000000024517caa8 closure #1 in DynamicBody.updateValue() + 204 in SwiftUICore
 27 0x000000024517c620 DynamicBody.updateValue() + 1184 in SwiftUICore
 28 0x00000001cee51554 AG::Graph::UpdateStack::update() + 500 in AttributeGraph
 29 0x00000001cee51cf4 AG::Graph::update_attribute(AG::data::ptr<AG::Node>, unsigned int) + 352 in AttributeGraph
 30 0x00000001cee592bc AG::Graph::value_ref(AG::AttributeID, unsigned int, AGSwiftMetadata const*, unsigned char&) + 296 in AttributeGraph
 31 0x00000001cee72718 AGGraphGetValue + 312 in AttributeGraph
 32 0x00000002454025ac GraphHost.instantiate() + 380 in SwiftUICore
 33 0x0000000245180474 static Update.dispatchImmediately<A>(reason:_:) + 308 in SwiftUICore
... 

Backtrace took 0.60s

Press space to interact, D to debug, or any other key to quit (11s)  failed

zsh: abort      .build/debug/KotaMenuBar