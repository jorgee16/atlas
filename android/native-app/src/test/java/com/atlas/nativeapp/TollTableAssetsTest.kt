package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class TollTableAssetsTest {
    @Test fun onlyRegionCountryNamesCanBecomeAssetPaths() {
        assertTrue(TollTableAssets.safeCountry("Portugal"))
        assertTrue(TollTableAssets.safeCountry("United Kingdom"))
        assertFalse(TollTableAssets.safeCountry("../Portugal"))
        assertFalse(TollTableAssets.safeCountry("Portugal/../private"))
        assertFalse(TollTableAssets.safeCountry(""))
        assertFalse(TollTableAssets.safeCountry("PT.csv"))
    }
}
