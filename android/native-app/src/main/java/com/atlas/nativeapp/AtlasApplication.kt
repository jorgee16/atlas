package com.atlas.nativeapp

import android.app.Application
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner

/**
 * A navigation session must outlive individual Activities, including when the user
 * temporarily opens another application. The foreground service owns GPS and TTS;
 * this Application owns the native model and JNI state for the process lifetime.
 */
class AtlasApplication : Application(), ViewModelStoreOwner {
    override val viewModelStore: ViewModelStore = ViewModelStore()
    val model: AtlasModel by lazy {
        ViewModelProvider(this, ViewModelProvider.AndroidViewModelFactory.getInstance(this))[AtlasModel::class.java]
    }
}
