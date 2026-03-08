package com.majuu.app;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Point;
import android.view.Display;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SafeAreaInsets")
public class SafeAreaInsetsPlugin extends Plugin {
    private JSObject lastInsets = makeInsetsPayload(0, 0, 0, 0);
    private View rootView;

    @Override
    public void load() {
        super.load();
        attachInsetsListener();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        requestInsetsPass();
        publishInsetsIfChanged();
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        JSObject payload = readCurrentInsets();
        lastInsets = payload;
        call.resolve(payload);
    }

    @PluginMethod
    public void refreshInsets(PluginCall call) {
        requestInsetsPass();
        if (rootView == null) {
            call.resolve(readCurrentInsets());
            return;
        }

        rootView.post(() -> {
            requestInsetsPass();
            JSObject payload = readCurrentInsets();
            lastInsets = payload;
            call.resolve(payload);
        });
    }

    private void attachInsetsListener() {
        Activity activity = getActivity();
        if (activity == null) return;

        rootView = activity.getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(rootView, (view, insets) -> {
            JSObject payload = toPayload(insets);
            lastInsets = payload;
            notifyListeners("insetsChange", payload, true);
            return insets;
        });

        rootView.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (left == oldLeft && top == oldTop && right == oldRight && bottom == oldBottom) return;
            publishInsetsIfChanged();
        });

        requestInsetsPass();
        publishInsetsIfChanged();
    }

    private void requestInsetsPass() {
        Activity activity = getActivity();
        if (activity == null) return;

        View root = rootView != null ? rootView : activity.getWindow().getDecorView();
        root.post(() -> ViewCompat.requestApplyInsets(root));
    }

    private JSObject readCurrentInsets() {
        Activity activity = getActivity();
        if (activity == null) return lastInsets;

        View root = rootView != null ? rootView : activity.getWindow().getDecorView();
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
        JSObject payload = insets != null ? toPayload(insets) : lastInsets;

        int[] displayFallback = getDisplayInsetsFallback(activity);
        int top = Math.max(payload.getInteger("top", 0), displayFallback[0]);
        int right = Math.max(payload.getInteger("right", 0), displayFallback[1]);
        int bottom = Math.max(payload.getInteger("bottom", 0), displayFallback[2]);
        int left = Math.max(payload.getInteger("left", 0), displayFallback[3]);

        return makeInsetsPayload(top, right, bottom, left);
    }

    private void publishInsetsIfChanged() {
        JSObject payload = readCurrentInsets();
        if (sameInsets(lastInsets, payload)) return;
        lastInsets = payload;
        notifyListeners("insetsChange", payload, true);
    }

    private JSObject toPayload(WindowInsetsCompat insets) {
        Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
        Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());

        int top = Math.max(systemBars.top, cutout.top);
        int right = Math.max(systemBars.right, cutout.right);
        int bottom = Math.max(systemBars.bottom, cutout.bottom);
        int left = Math.max(systemBars.left, cutout.left);
        return makeInsetsPayload(top, right, bottom, left);
    }

    private int[] getDisplayInsetsFallback(Activity activity) {
        int orientation = activity.getResources().getConfiguration().orientation;
        int top = 0;
        int right = 0;
        int bottom = 0;
        int left = 0;

        Display display = activity.getWindowManager().getDefaultDisplay();
        Point appSize = new Point();
        Point realSize = new Point();
        display.getSize(appSize);
        display.getRealSize(realSize);

        int diffX = Math.max(0, realSize.x - appSize.x);
        int diffY = Math.max(0, realSize.y - appSize.y);

        if (diffY > 0) {
            bottom = diffY;
        } else if (diffX > 0) {
            if (orientation == Configuration.ORIENTATION_LANDSCAPE) {
                right = diffX;
            } else {
                bottom = diffX;
            }
        }

        return new int[] { top, right, bottom, left };
    }

    private static boolean sameInsets(JSObject a, JSObject b) {
        return a.getInteger("top", 0) == b.getInteger("top", 0)
            && a.getInteger("right", 0) == b.getInteger("right", 0)
            && a.getInteger("bottom", 0) == b.getInteger("bottom", 0)
            && a.getInteger("left", 0) == b.getInteger("left", 0);
    }

    private static JSObject makeInsetsPayload(int top, int right, int bottom, int left) {
        JSObject payload = new JSObject();
        payload.put("top", Math.max(0, top));
        payload.put("right", Math.max(0, right));
        payload.put("bottom", Math.max(0, bottom));
        payload.put("left", Math.max(0, left));
        return payload;
    }
}
