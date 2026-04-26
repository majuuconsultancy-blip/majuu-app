package com.majuu.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ExternalFileOpener")
public class ExternalFileOpenerPlugin extends Plugin {

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "").trim();
        String mimeType = call.getString("mimeType", "").trim();
        String title = call.getString("title", "Open with").trim();

        if (url.isEmpty()) {
            call.reject("URL is required.");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is not available.");
            return;
        }

        try {
            Uri uri = Uri.parse(url);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (mimeType.isEmpty()) {
                intent.setData(uri);
            } else {
                intent.setDataAndType(uri, mimeType);
            }

            Intent chooser = Intent.createChooser(intent, title.isEmpty() ? "Open with" : title);
            activity.startActivity(chooser);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("No compatible app is available to open this file.", error);
        } catch (Exception error) {
            call.reject("Could not open this file.", error);
        }
    }
}
