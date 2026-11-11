package com.lightning.pdfreader

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.annotation.Keep
import app.tauri.annotation.Command
import app.tauri.annotation.ActivityCallback
import androidx.activity.result.ActivityResult
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.JSArray
import app.tauri.plugin.Plugin

@InvokeArg
@Keep
class FileNameArgs { lateinit var uri: String }

@TauriPlugin
@Keep
class LightningFilesPlugin(private val activity: Activity): Plugin(activity) {
    @Command
    fun pickFiles(invoke: Invoke) {
        val intent=Intent(Intent.ACTION_OPEN_DOCUMENT)
        intent.addCategory(Intent.CATEGORY_OPENABLE)
        intent.type="application/pdf"
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true)
        startActivityForResult(invoke,intent,"picked")
    }
    @ActivityCallback
    @Keep
    fun picked(invoke: Invoke, result: ActivityResult) {
        val files=JSArray()
        if(result.resultCode==Activity.RESULT_OK){
            val clips=result.data?.clipData
            if(clips!=null){for(i in 0 until clips.itemCount)files.put(clips.getItemAt(i).uri.toString())}
            else result.data?.data?.let{files.put(it.toString())}
        }
        val response=JSObject();response.put("files",files);invoke.resolve(response)
    }
    @Command
    fun name(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(FileNameArgs::class.java)
            val result = JSObject()
            activity.contentResolver.query(Uri.parse(args.uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) result.put("name", cursor.getString(0))
            }
            invoke.resolve(result)
        } catch (error: Exception) { invoke.reject("无法读取文件名称：${error.message}") }
    }
}
