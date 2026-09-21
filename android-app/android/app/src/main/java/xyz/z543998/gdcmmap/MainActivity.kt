package xyz.z543998.gdcmmap

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import xyz.z543998.gdcmmap.compass.CompassPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(CompassPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
