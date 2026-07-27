// Phase 3 task 3.6: classic Objective-C bridge exposing the Swift
// AppBlockerModule (an RCTEventEmitter subclass) to React Native. NOT
// compiled or run anywhere in this repo (no Mac).
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(AppBlockerModule, RCTEventEmitter)

RCT_EXTERN_METHOD(start
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getStatus
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
