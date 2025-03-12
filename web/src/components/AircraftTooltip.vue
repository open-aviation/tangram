<template>
    <p id="tooltip">
        <span id="callsign">{{ aircraft.callsign }}</span>
        <span id="typecode">{{ aircraft.typecode }}</span>
        <br />
        <span id="registration">{{ aircraft.registration }}</span>
        <span id="icao24">{{ aircraft.icao24 }}</span>
        <br />
        <span id="altitude">FL{{ Math.round(aircraft.altitude / 1000) * 10
            }}</span>
    </p>
</template>

<script>
export default {
    props: ['aircraft']
}
</script>

<style scoped>
p {
    font-size: 11px;
    min-width: 100px;
    height: 2rem;
}

span {
    display: flex;
}

#callsign {
    font-weight: bold;
    font-size: 1.1em;
    display: inline;
}

#typecode {
    display: block;
    float: right;
}

#registration {
    display: inline;
    float: left;
}

#icao24 {
    display: inline;
    float: right;
}
</style>
