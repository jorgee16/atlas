package com.atlas.nativeapp

internal object MapVisualStyle {
    const val STREETS="streets"
    const val SATELLITE="satellite"
    const val HYBRID="hybrid"
    fun valid(value:String)=value==STREETS || value==SATELLITE || value==HYBRID
    fun usesImagery(style:String,sourceMode:String)=
        valid(style) && style!=STREETS && sourceMode!=MapSourcePolicy.OFFLINE
}
