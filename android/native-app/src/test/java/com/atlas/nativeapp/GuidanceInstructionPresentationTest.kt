package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class GuidanceInstructionPresentationTest {
    @Test fun rampDestinationsAreLegibleWithoutRawOsmSeparators() {
        val shown=GuidanceInstructionPresentation.format(
            "Take the ramp on the right toward Sobral de Monte Agraço;Enxara / EN 9-2;EN")
        assertEquals("Take the ramp on the right",shown.action)
        assertEquals("Toward Sobral de Monte Agraço · Enxara / EN 9-2 · EN",shown.destination)
    }

    @Test fun roundaboutAndStreetDirectionsKeepTheirRoadNames() {
        val r=GuidanceInstructionPresentation.format(
            "At the roundabout, take the 2nd exit onto A 8;EN 8")
        assertEquals("At the roundabout, take the 2nd exit",r.action)
        assertEquals("Onto A 8 · EN 8",r.destination)
        val turn=GuidanceInstructionPresentation.format("Turn left onto Rua do Sol")
        assertEquals("Turn left",turn.action)
        assertEquals("Onto Rua do Sol",turn.destination)
    }

    @Test fun ordinaryAndEmptyManeuversHaveSafeActions() {
        assertEquals(GuidanceInstructionPresentation.Text(
            "Continue on your route",null),GuidanceInstructionPresentation.format(null))
        assertEquals(GuidanceInstructionPresentation.Text(
            "You have arrived",null),
            GuidanceInstructionPresentation.format("You have arrived"))
        assertEquals(GuidanceInstructionPresentation.Text(
            "Take the ramp",null),
            GuidanceInstructionPresentation.format("Take the ramp"))
    }

    @Test fun destinationListSpacingIsNormalizedWithoutRemovingLocations() {
        val shown=GuidanceInstructionPresentation.format(
            "Turn right toward  Sobral  ; Enxara;  Torres Vedras")
        assertEquals("Turn right",shown.action)
        assertEquals("Toward Sobral · Enxara · Torres Vedras",shown.destination)
    }
    @Test fun roundaboutShowsOnlyExitRoadNotDuplicateExitNumber() {
        assertEquals("A 36 · IC 17 · CRIL",GuidanceInstructionPresentation.roundaboutDestination(
            "At the roundabout, take the 1st exit onto A 36; IC 17; CRIL",
            "Circular Regional Interior de Lisboa"))
        assertEquals("Sintra · A16",GuidanceInstructionPresentation.roundaboutDestination(
            "At the roundabout, take the 2nd exit toward Sintra; A16",null))
        assertEquals("Rua do Sol",GuidanceInstructionPresentation.roundaboutDestination(
            "At the roundabout, take the 3rd exit","Rua do Sol"))
    }
}
