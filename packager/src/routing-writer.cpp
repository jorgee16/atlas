#include "roam/routing-writer.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace fs = std::filesystem;

namespace roam {

namespace {

constexpr std::uint32_t routingFormatVersion = 5;
constexpr std::uint32_t nodeRecordBytes = 12;
constexpr std::uint32_t edgeRecordBytes = 20;
constexpr std::uint32_t geometryArcRecordBytes = 8;
constexpr std::uint32_t geometryPointRecordBytes = 8;
constexpr std::uint32_t roadRecordBytes = 36;
constexpr std::uint32_t restrictionRecordBytes = 16;
constexpr std::uint32_t cellRecordBytes = 16;
constexpr double maximumTopologySegmentMeters = 200.0;

struct CellNode {
  std::int32_t x = 0;
  std::int32_t y = 0;
  std::uint32_t node = 0;
};

struct Bounds {
  double left;
  double bottom;
  double right;
  double top;
};

struct PartitionDefinition {
  std::string_view id;
  Bounds bounds;
};

constexpr std::array<
  PartitionDefinition,
  3
> portugalPartitions {{
  {
    "mainland",
    {-9.7, 36.8, -6.0, 42.3}
  },
  {
    "madeira",
    {-17.5, 32.4, -16.0, 33.3}
  },
  {
    "azores",
    {-31.5, 36.7, -24.0, 40.1}
  }
}};

void requireStream(
  const std::ofstream& stream,
  const fs::path& output
) {
  if (!stream) {
    throw std::runtime_error(
      "Unable to write routing asset: " +
      output.string()
    );
  }
}

void writeMagic(
  std::ofstream& stream,
  std::string_view magic
) {
  stream.write(
    magic.data(),
    static_cast<std::streamsize>(
      magic.size()
    )
  );
}

void writeU32(
  std::ofstream& stream,
  std::uint32_t value
) {
  const char bytes[4] = {
    static_cast<char>(value & 0xffU),
    static_cast<char>((value >> 8U) & 0xffU),
    static_cast<char>((value >> 16U) & 0xffU),
    static_cast<char>((value >> 24U) & 0xffU)
  };

  stream.write(bytes, 4);
}

void writeI32(
  std::ofstream& stream,
  std::int32_t value
) {
  writeU32(
    stream,
    std::bit_cast<std::uint32_t>(value)
  );
}

void writeF32(
  std::ofstream& stream,
  float value
) {
  static_assert(
    sizeof(float) == sizeof(std::uint32_t)
  );

  writeU32(
    stream,
    std::bit_cast<std::uint32_t>(value)
  );
}

void prepareEdges(RoadGraph& graph) {
  if (
    graph.edges.size() >
    std::numeric_limits<std::uint32_t>::max()
  ) {
    throw std::runtime_error(
      "Routing graph exceeds the 32-bit edge limit."
    );
  }

  std::sort(
    graph.edges.begin(),
    graph.edges.end(),
    [](
      const RoadEdge& left,
      const RoadEdge& right
    ) {
      if (left.from != right.from) {
        return left.from < right.from;
      }

      if (left.to != right.to) {
        return left.to < right.to;
      }

      if (left.road != right.road) {
        return left.road < right.road;
      }

      return left.durationCentiseconds <
        right.durationCentiseconds;
    }
  );

  graph.edges.erase(
    std::unique(
      graph.edges.begin(),
      graph.edges.end(),
      [](
        const RoadEdge& left,
        const RoadEdge& right
      ) {
        return (
          left.from == right.from &&
          left.to == right.to &&
          left.road == right.road
        );
      }
    ),
    graph.edges.end()
  );
}

void appendGeometryArc(
  const RoadGraph& source,
  std::uint32_t sourceArcIndex,
  RoadGraph& destination
) {
  if (
    sourceArcIndex >=
      source.geometryArcs.size() ||
    destination.geometryArcs.size() >=
      std::numeric_limits<
        std::uint32_t
      >::max()
  ) {
    throw std::runtime_error(
      "Routing geometry contains an invalid arc."
    );
  }

  const auto& sourceArc =
    source.geometryArcs[sourceArcIndex];

  const std::size_t sourceEnd =
    static_cast<std::size_t>(
      sourceArc.offset
    ) + sourceArc.count;

  if (sourceEnd > source.geometryPoints.size()) {
    throw std::runtime_error(
      "Routing geometry arc exceeds its point array."
    );
  }

  const auto maximumU32 =
    std::numeric_limits<
      std::uint32_t
    >::max();

  if (
    destination.geometryPoints.size() >
      maximumU32 - sourceArc.count
  ) {
    throw std::runtime_error(
      "Routing geometry exceeds the 32-bit point limit."
    );
  }

  const auto destinationOffset =
    static_cast<std::uint32_t>(
      destination.geometryPoints.size()
    );

  destination.geometryPoints.insert(
    destination.geometryPoints.end(),
    source.geometryPoints.begin() +
      sourceArc.offset,
    source.geometryPoints.begin() +
      sourceEnd
  );

  destination.geometryArcs.push_back({
    destinationOffset,
    sourceArc.count
  });
}

void compactGeometry(RoadGraph& graph) {
  constexpr std::uint32_t unassigned =
    std::numeric_limits<std::uint32_t>::max();

  std::vector<std::uint32_t> remapped(
    graph.geometryArcs.size(),
    unassigned
  );

  RoadGraph compact;

  for (auto& edge : graph.edges) {
    if (
      edge.geometryArc >=
        graph.geometryArcs.size()
    ) {
      throw std::runtime_error(
        "Routing edge references an invalid geometry arc."
      );
    }

    auto& target = remapped[edge.geometryArc];

    if (target == unassigned) {
      target = static_cast<std::uint32_t>(
        compact.geometryArcs.size()
      );

      appendGeometryArc(
        graph,
        edge.geometryArc,
        compact
      );
    }

    edge.geometryArc = target;
  }

  graph.geometryArcs =
    std::move(compact.geometryArcs);

  graph.geometryPoints =
    std::move(compact.geometryPoints);
}

void compactRoads(RoadGraph& graph) {
  constexpr std::uint32_t unassigned =
    std::numeric_limits<std::uint32_t>::max();

  std::vector<std::uint32_t> remapped(
    graph.roads.size(),
    unassigned
  );

  std::vector<RoadMetadata> roads;

  for (auto& edge : graph.edges) {
    if (edge.road >= graph.roads.size()) {
      throw std::runtime_error(
        "Routing edge references an invalid road."
      );
    }

    auto& target = remapped[edge.road];

    if (target == unassigned) {
      if (
        roads.size() >=
          std::numeric_limits<
            std::uint32_t
          >::max()
      ) {
        throw std::runtime_error(
          "Routing graph exceeds the 32-bit road limit."
        );
      }

      target = static_cast<std::uint32_t>(
        roads.size()
      );

      roads.push_back(
        std::move(graph.roads[edge.road])
      );
    }

    edge.road = target;
  }

  std::vector<RoadTurnRestriction> restrictions;
  restrictions.reserve(
    graph.turnRestrictions.size()
  );

  for (auto restriction : graph.turnRestrictions) {
    if (
      restriction.viaNode >= graph.nodes.size() ||
      restriction.fromRoad >= remapped.size() ||
      restriction.toRoad >= remapped.size() ||
      remapped[restriction.fromRoad] == unassigned ||
      remapped[restriction.toRoad] == unassigned
    ) {
      continue;
    }

    restriction.fromRoad =
      remapped[restriction.fromRoad];

    restriction.toRoad =
      remapped[restriction.toRoad];

    restrictions.push_back(restriction);
  }

  graph.roads = std::move(roads);
  graph.turnRestrictions =
    std::move(restrictions);

  std::sort(
    graph.turnRestrictions.begin(),
    graph.turnRestrictions.end(),
    [](
      const RoadTurnRestriction& left,
      const RoadTurnRestriction& right
    ) {
      if (left.viaNode != right.viaNode) {
        return left.viaNode < right.viaNode;
      }

      if (left.fromRoad != right.fromRoad) {
        return left.fromRoad < right.fromRoad;
      }

      if (left.toRoad != right.toRoad) {
        return left.toRoad < right.toRoad;
      }

      return left.only < right.only;
    }
  );

  graph.turnRestrictions.erase(
    std::unique(
      graph.turnRestrictions.begin(),
      graph.turnRestrictions.end(),
      [](
        const RoadTurnRestriction& left,
        const RoadTurnRestriction& right
      ) {
        return (
          left.viaNode == right.viaNode &&
          left.fromRoad == right.fromRoad &&
          left.toRoad == right.toRoad &&
          left.only == right.only
        );
      }
    ),
    graph.turnRestrictions.end()
  );
}

void writeNodes(
  const RoadGraph& graph,
  const fs::path& output
) {
  std::ofstream stream {
    output,
    std::ios::binary
  };

  requireStream(stream, output);

  writeMagic(stream, "RNOD");
  writeU32(stream, routingFormatVersion);
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      graph.nodes.size()
    )
  );
  writeU32(stream, nodeRecordBytes);

  for (const auto& node : graph.nodes) {
    writeF32(
      stream,
      static_cast<float>(node.lat)
    );
    writeF32(
      stream,
      static_cast<float>(node.lon)
    );
    writeU32(stream, node.component);
  }

  requireStream(stream, output);
}

void writeEdges(
  const RoadGraph& graph,
  const fs::path& output
) {
  std::ofstream stream {
    output,
    std::ios::binary
  };

  requireStream(stream, output);

  writeMagic(stream, "REDG");
  writeU32(stream, routingFormatVersion);
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      graph.nodes.size()
    )
  );
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      graph.edges.size()
    )
  );
  writeU32(stream, edgeRecordBytes);

  std::vector<std::uint32_t> offsets(
    graph.nodes.size() + 1,
    0
  );

  for (const auto& edge : graph.edges) {
    offsets[edge.from + 1] += 1;
  }

  for (
    std::size_t index = 1;
    index < offsets.size();
    ++index
  ) {
    offsets[index] +=
      offsets[index - 1];
  }

  for (const auto offset : offsets) {
    writeU32(stream, offset);
  }

  for (const auto& edge : graph.edges) {
    if (
      edge.durationCentiseconds >
        0x00ffffffU ||
      edge.geometryArc >= 0x20000000U ||
      edge.road >= graph.roads.size()
    ) {
      throw std::runtime_error(
        "A routing edge exceeds the packed format limit."
      );
    }

    const std::uint32_t durationAndMetadata =
      edge.durationCentiseconds |
      (
        static_cast<std::uint32_t>(
          edge.roadClass
        ) & 0x7fU
      ) << 24U |
      (edge.oneWay ? 1U << 31U : 0U);

    const std::uint32_t geometryAndDirection =
      edge.geometryArc |
      (edge.driveAllowed ? 1U << 29U : 0U) |
      (edge.walkAllowed ? 1U << 30U : 0U) |
      (
        edge.geometryReversed
          ? 1U << 31U
          : 0U
      );

    writeU32(stream, edge.to);
    writeU32(
      stream,
      edge.distanceDecimeters
    );
    writeU32(
      stream,
      durationAndMetadata
    );
    writeU32(
      stream,
      geometryAndDirection
    );
    writeU32(stream, edge.road);
  }

  requireStream(stream, output);
}

void writeGeometry(
  const RoadGraph& graph,
  const fs::path& output
) {
  std::ofstream stream {
    output,
    std::ios::binary
  };

  requireStream(stream, output);

  writeMagic(stream, "RGEO");
  writeU32(stream, routingFormatVersion);
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      graph.geometryArcs.size()
    )
  );
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      graph.geometryPoints.size()
    )
  );
  writeU32(
    stream,
    geometryArcRecordBytes
  );
  writeU32(
    stream,
    geometryPointRecordBytes
  );

  for (const auto& arc : graph.geometryArcs) {
    const std::size_t end =
      static_cast<std::size_t>(
        arc.offset
      ) + arc.count;

    if (end > graph.geometryPoints.size()) {
      throw std::runtime_error(
        "Routing geometry contains an invalid arc range."
      );
    }

    writeU32(stream, arc.offset);
    writeU32(stream, arc.count);
  }

  for (const auto& point : graph.geometryPoints) {
    writeF32(
      stream,
      static_cast<float>(point.lat)
    );
    writeF32(
      stream,
      static_cast<float>(point.lon)
    );
  }

  requireStream(stream, output);
}

struct EncodedRoad {
  std::uint32_t nameOffset = 0;
  std::uint32_t referenceOffset = 0;
  std::uint32_t destinationOffset = 0;
  std::uint32_t lanesOffset = 0;
  std::uint32_t turnLanesOffset = 0;
  std::uint32_t turnLanesForwardOffset = 0;
  std::uint32_t turnLanesBackwardOffset = 0;
  std::uint32_t destinationLanesOffset = 0;
  std::uint32_t flags = 0;
};

struct EncodedRoadAssets {
  std::vector<EncodedRoad> roads;
  std::string strings {"\0", 1};
};

EncodedRoadAssets encodeRoads(
  const RoadGraph& graph
) {
  EncodedRoadAssets encoded;
  encoded.roads.reserve(graph.roads.size());

  std::unordered_map<std::string, std::uint32_t>
    offsets;

  offsets.emplace("", 0);

  const auto intern = [
    &encoded,
    &offsets
  ](const std::string& value) {
    const auto found = offsets.find(value);

    if (found != offsets.end()) {
      return found->second;
    }

    if (
      encoded.strings.size() >
        std::numeric_limits<
          std::uint32_t
        >::max() - value.size() - 1
    ) {
      throw std::runtime_error(
        "Routing string table exceeds the 32-bit limit."
      );
    }

    const auto offset =
      static_cast<std::uint32_t>(
        encoded.strings.size()
      );

    encoded.strings.append(value);
    encoded.strings.push_back('\0');
    offsets.emplace(value, offset);

    return offset;
  };

  for (const auto& road : graph.roads) {
    std::uint32_t flags = 0;

    if (road.roundabout) {
      flags |= 1U;
    }

    if (road.link) {
      flags |= 1U << 1U;
    }

    encoded.roads.push_back({
      intern(road.name),
      intern(road.reference),
      intern(road.destination),
      intern(road.lanes),
      intern(road.turnLanes),
      intern(road.turnLanesForward),
      intern(road.turnLanesBackward),
      intern(road.destinationLanes),
      flags
    });
  }

  return encoded;
}

void writeRoads(
  const EncodedRoadAssets& encoded,
  const fs::path& output
) {
  std::ofstream stream {
    output,
    std::ios::binary
  };

  requireStream(stream, output);

  writeMagic(stream, "RROD");
  writeU32(stream, routingFormatVersion);
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      encoded.roads.size()
    )
  );
  writeU32(stream, roadRecordBytes);

  for (const auto& road : encoded.roads) {
    writeU32(stream, road.nameOffset);
    writeU32(stream, road.referenceOffset);
    writeU32(stream, road.destinationOffset);
    writeU32(stream, road.lanesOffset);
    writeU32(stream, road.turnLanesOffset);
    writeU32(stream, road.turnLanesForwardOffset);
    writeU32(stream, road.turnLanesBackwardOffset);
    writeU32(stream, road.destinationLanesOffset);
    writeU32(stream, road.flags);
  }

  requireStream(stream, output);
}

void writeStrings(
  const EncodedRoadAssets& encoded,
  const fs::path& output
) {
  std::ofstream stream {
    output,
    std::ios::binary
  };

  requireStream(stream, output);

  writeMagic(stream, "RSTR");
  writeU32(stream, routingFormatVersion);
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      encoded.strings.size()
    )
  );

  stream.write(
    encoded.strings.data(),
    static_cast<std::streamsize>(
      encoded.strings.size()
    )
  );

  requireStream(stream, output);
}

void writeRestrictions(
  const RoadGraph& graph,
  const fs::path& output
) {
  auto restrictions = graph.turnRestrictions;

  std::sort(
    restrictions.begin(),
    restrictions.end(),
    [](
      const RoadTurnRestriction& left,
      const RoadTurnRestriction& right
    ) {
      if (left.viaNode != right.viaNode) {
        return left.viaNode < right.viaNode;
      }

      if (left.fromRoad != right.fromRoad) {
        return left.fromRoad < right.fromRoad;
      }

      if (left.toRoad != right.toRoad) {
        return left.toRoad < right.toRoad;
      }

      return left.only < right.only;
    }
  );

  restrictions.erase(
    std::unique(
      restrictions.begin(),
      restrictions.end(),
      [](
        const RoadTurnRestriction& left,
        const RoadTurnRestriction& right
      ) {
        return (
          left.viaNode == right.viaNode &&
          left.fromRoad == right.fromRoad &&
          left.toRoad == right.toRoad &&
          left.only == right.only
        );
      }
    ),
    restrictions.end()
  );

  std::ofstream stream {
    output,
    std::ios::binary
  };

  requireStream(stream, output);

  writeMagic(stream, "RTRN");
  writeU32(stream, routingFormatVersion);
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      restrictions.size()
    )
  );
  writeU32(stream, restrictionRecordBytes);

  for (const auto& restriction : restrictions) {
    if (
      restriction.viaNode >= graph.nodes.size() ||
      restriction.fromRoad >= graph.roads.size() ||
      restriction.toRoad >= graph.roads.size()
    ) {
      throw std::runtime_error(
        "Routing turn restriction references invalid topology."
      );
    }

    writeU32(stream, restriction.viaNode);
    writeU32(stream, restriction.fromRoad);
    writeU32(stream, restriction.toRoad);
    writeU32(
      stream,
      restriction.only ? 1U : 0U
    );
  }

  requireStream(stream, output);
}

void writeSpatialIndex(
  const RoadGraph& graph,
  const fs::path& output
) {
  std::vector<CellNode> entries;
  entries.reserve(graph.nodes.size());

  for (
    std::uint32_t node = 0;
    node < graph.nodes.size();
    ++node
  ) {
    const auto& value = graph.nodes[node];

    entries.push_back({
      static_cast<std::int32_t>(
        std::floor(
          value.lon /
          RoutingWriter::spatialCellSizeDegrees
        )
      ),
      static_cast<std::int32_t>(
        std::floor(
          value.lat /
          RoutingWriter::spatialCellSizeDegrees
        )
      ),
      node
    });
  }

  std::sort(
    entries.begin(),
    entries.end(),
    [](
      const CellNode& left,
      const CellNode& right
    ) {
      if (left.x != right.x) {
        return left.x < right.x;
      }

      if (left.y != right.y) {
        return left.y < right.y;
      }

      return left.node < right.node;
    }
  );

  std::uint32_t cellCount = 0;

  for (
    std::size_t index = 0;
    index < entries.size();
  ) {
    cellCount += 1;

    const auto x = entries[index].x;
    const auto y = entries[index].y;

    while (
      index < entries.size() &&
      entries[index].x == x &&
      entries[index].y == y
    ) {
      index += 1;
    }
  }

  std::ofstream stream {
    output,
    std::ios::binary
  };

  requireStream(stream, output);

  writeMagic(stream, "RGRD");
  writeU32(stream, routingFormatVersion);
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      std::round(
        RoutingWriter::spatialCellSizeDegrees *
        1'000'000.0
      )
    )
  );
  writeU32(stream, cellCount);
  writeU32(
    stream,
    static_cast<std::uint32_t>(
      entries.size()
    )
  );
  writeU32(stream, cellRecordBytes);

  std::size_t index = 0;

  while (index < entries.size()) {
    const auto start = index;
    const auto x = entries[index].x;
    const auto y = entries[index].y;

    while (
      index < entries.size() &&
      entries[index].x == x &&
      entries[index].y == y
    ) {
      index += 1;
    }

    writeI32(stream, x);
    writeI32(stream, y);
    writeU32(
      stream,
      static_cast<std::uint32_t>(start)
    );
    writeU32(
      stream,
      static_cast<std::uint32_t>(
        index - start
      )
    );
  }

  for (const auto& entry : entries) {
    writeU32(stream, entry.node);
  }

  requireStream(stream, output);
}

void writeMetadata(
  const std::string& region,
  const RoadGraph& graph,
  const fs::path& outputDirectory
) {
  const fs::path nodes =
    outputDirectory / "nodes.bin";

  const fs::path edges =
    outputDirectory / "edges.bin";

  const fs::path geometry =
    outputDirectory / "geometry.bin";

  const fs::path roads =
    outputDirectory / "roads.bin";

  const fs::path strings =
    outputDirectory / "strings.bin";

  const fs::path restrictions =
    outputDirectory / "restrictions.bin";

  const fs::path spatialIndex =
    outputDirectory /
    "spatial-index.bin";

  nlohmann::json metadata = {
    {"id", region},
    {"version", routingFormatVersion},
    {"profiles", {"drive", "walk"}},
    {"weight", "estimated-travel-time"},
    {"graph", "contracted-junction-topology"},
    {
      "maximumTopologySegmentMeters",
      maximumTopologySegmentMeters
    },
    {"nodeCount", graph.nodes.size()},
    {"directedEdgeCount", graph.edges.size()},
    {
      "geometryArcCount",
      graph.geometryArcs.size()
    },
    {
      "geometryPointCount",
      graph.geometryPoints.size()
    },
    {"roadCount", graph.roads.size()},
    {
      "turnRestrictionCount",
      graph.turnRestrictions.size()
    },
    {"componentCount", graph.componentCount},
    {
      "spatialIndex",
      {
        {"kind", "uniform-grid"},
        {
          "cellSizeDegrees",
          RoutingWriter::spatialCellSizeDegrees
        }
      }
    },
    {
      "assets",
      {
        {"nodes", "nodes.bin"},
        {"edges", "edges.bin"},
        {"geometry", "geometry.bin"},
        {"roads", "roads.bin"},
        {"strings", "strings.bin"},
        {
          "restrictions",
          "restrictions.bin"
        },
        {
          "spatialIndex",
          "spatial-index.bin"
        }
      }
    },
    {
      "sizeBytes",
      fs::file_size(nodes) +
        fs::file_size(edges) +
        fs::file_size(geometry) +
        fs::file_size(roads) +
        fs::file_size(strings) +
        fs::file_size(restrictions) +
        fs::file_size(spatialIndex)
    },
    {
      "limitations",
      {
        "Via-node OSM turn restrictions are enforced; via-way and conditional restrictions are not included in routing format v3.",
        "Travel times use OSM maxspeed tags and profile defaults, not live traffic.",
        "Walking uses pedestrian-accessible roads, footways, paths, tracks, pedestrian streets, and steps when permitted.",
        "Driving keeps the existing road-speed profile and motor-vehicle access filtering."
      }
    }
  };

  const fs::path output =
    outputDirectory / "metadata.json";

  std::ofstream stream {output};

  requireStream(stream, output);

  stream
    << metadata.dump(2)
    << '\n';

  requireStream(stream, output);
}

bool inBounds(
  const RoadNode& node,
  const Bounds& bounds
) {
  return (
    node.lon >= bounds.left &&
    node.lon <= bounds.right &&
    node.lat >= bounds.bottom &&
    node.lat <= bounds.top
  );
}

void normalizeComponents(
  RoadGraph& graph
) {
  std::unordered_map<
    std::uint32_t,
    std::uint32_t
  > components;

  graph.componentCount = 0;

  for (auto& node : graph.nodes) {
    const auto [entry, inserted] =
      components.emplace(
        node.component,
        static_cast<std::uint32_t>(
          components.size()
        )
      );

    node.component = entry->second;

    if (inserted) {
      graph.componentCount =
        static_cast<std::uint32_t>(
          components.size()
        );
    }
  }
}

void writeGraph(
  const std::string& region,
  RoadGraph graph,
  const fs::path& outputDirectory
) {
  if (graph.nodes.empty()) {
    throw std::runtime_error(
      "No routable car roads were found for " +
      region +
      "."
    );
  }

  fs::create_directories(
    outputDirectory
  );

  prepareEdges(graph);
  compactGeometry(graph);
  compactRoads(graph);

  const auto encodedRoads =
    encodeRoads(graph);

  writeNodes(
    graph,
    outputDirectory / "nodes.bin"
  );

  writeEdges(
    graph,
    outputDirectory / "edges.bin"
  );

  writeGeometry(
    graph,
    outputDirectory / "geometry.bin"
  );

  writeRoads(
    encodedRoads,
    outputDirectory / "roads.bin"
  );

  writeStrings(
    encodedRoads,
    outputDirectory / "strings.bin"
  );

  writeRestrictions(
    graph,
    outputDirectory / "restrictions.bin"
  );

  writeSpatialIndex(
    graph,
    outputDirectory /
      "spatial-index.bin"
  );

  writeMetadata(
    region,
    graph,
    outputDirectory
  );
}

void writePortugalPartitions(
  const std::string& region,
  RoadGraph graph,
  const fs::path& outputDirectory
) {
  constexpr std::uint8_t unassigned = 0xff;

  std::array<RoadGraph, 3> partitions;

  std::vector<std::uint8_t> nodePartition(
    graph.nodes.size(),
    unassigned
  );

  std::vector<std::uint32_t> remappedNode(
    graph.nodes.size(),
    0
  );

  for (
    std::uint32_t nodeIndex = 0;
    nodeIndex < graph.nodes.size();
    ++nodeIndex
  ) {
    for (
      std::uint8_t partitionIndex = 0;
      partitionIndex <
        portugalPartitions.size();
      ++partitionIndex
    ) {
      if (
        !inBounds(
          graph.nodes[nodeIndex],
          portugalPartitions[
            partitionIndex
          ].bounds
        )
      ) {
        continue;
      }

      nodePartition[nodeIndex] =
        partitionIndex;

      remappedNode[nodeIndex] =
        static_cast<std::uint32_t>(
          partitions[partitionIndex]
            .nodes.size()
        );

      partitions[partitionIndex]
        .nodes.push_back(
          std::move(
            graph.nodes[nodeIndex]
          )
        );

      break;
    }
  }

  graph.nodes.clear();
  graph.nodes.shrink_to_fit();

  std::vector<std::uint8_t> arcPartition(
    graph.geometryArcs.size(),
    unassigned
  );

  std::vector<std::uint32_t> remappedArc(
    graph.geometryArcs.size(),
    0
  );

  constexpr std::uint32_t unassignedRoad =
    std::numeric_limits<std::uint32_t>::max();

  std::array<
    std::vector<std::uint32_t>,
    3
  > remappedRoads;

  for (auto& remapped : remappedRoads) {
    remapped.assign(
      graph.roads.size(),
      unassignedRoad
    );
  }

  for (auto& edge : graph.edges) {
    const auto fromPartition =
      nodePartition[edge.from];

    const auto toPartition =
      nodePartition[edge.to];

    if (
      fromPartition == unassigned ||
      fromPartition != toPartition
    ) {
      continue;
    }

    if (
      edge.geometryArc >=
        graph.geometryArcs.size()
    ) {
      throw std::runtime_error(
        "Routing edge references an invalid geometry arc."
      );
    }

    if (edge.road >= graph.roads.size()) {
      throw std::runtime_error(
        "Routing edge references an invalid road."
      );
    }

    if (
      arcPartition[edge.geometryArc] ==
        unassigned
    ) {
      arcPartition[edge.geometryArc] =
        fromPartition;

      remappedArc[edge.geometryArc] =
        static_cast<std::uint32_t>(
          partitions[fromPartition]
            .geometryArcs.size()
        );

      appendGeometryArc(
        graph,
        edge.geometryArc,
        partitions[fromPartition]
      );
    } else if (
      arcPartition[edge.geometryArc] !=
        fromPartition
    ) {
      throw std::runtime_error(
        "A routing geometry arc crosses partitions."
      );
    }

    edge.from = remappedNode[edge.from];
    edge.to = remappedNode[edge.to];
    edge.geometryArc =
      remappedArc[edge.geometryArc];

    auto& remappedRoad =
      remappedRoads[fromPartition][edge.road];

    if (remappedRoad == unassignedRoad) {
      remappedRoad =
        static_cast<std::uint32_t>(
          partitions[fromPartition]
            .roads.size()
        );

      partitions[fromPartition]
        .roads.push_back(
          graph.roads[edge.road]
        );
    }

    edge.road = remappedRoad;

    partitions[fromPartition]
      .edges.push_back(
        std::move(edge)
      );
  }

  for (
    const auto& restriction :
      graph.turnRestrictions
  ) {
    if (
      restriction.viaNode >=
        nodePartition.size() ||
      restriction.fromRoad >=
        graph.roads.size() ||
      restriction.toRoad >=
        graph.roads.size()
    ) {
      continue;
    }

    const auto partitionIndex =
      nodePartition[restriction.viaNode];

    if (partitionIndex == unassigned) {
      continue;
    }

    const auto fromRoad =
      remappedRoads[partitionIndex]
        [restriction.fromRoad];

    const auto toRoad =
      remappedRoads[partitionIndex]
        [restriction.toRoad];

    if (
      fromRoad == unassignedRoad ||
      toRoad == unassignedRoad
    ) {
      continue;
    }

    partitions[partitionIndex]
      .turnRestrictions.push_back({
        remappedNode[restriction.viaNode],
        fromRoad,
        toRoad,
        restriction.only
      });
  }

  graph.edges.clear();
  graph.edges.shrink_to_fit();
  graph.geometryArcs.clear();
  graph.geometryArcs.shrink_to_fit();
  graph.geometryPoints.clear();
  graph.geometryPoints.shrink_to_fit();
  graph.roads.clear();
  graph.roads.shrink_to_fit();
  graph.turnRestrictions.clear();
  graph.turnRestrictions.shrink_to_fit();

  fs::create_directories(
    outputDirectory
  );

  nlohmann::json manifest = {
    {"id", region},
    {"version", routingFormatVersion},
    {"profiles", {"drive", "walk"}},
    {"partitions", nlohmann::json::array()}
  };

  for (
    std::size_t index = 0;
    index < portugalPartitions.size();
    ++index
  ) {
    auto& partition = partitions[index];
    const auto& definition =
      portugalPartitions[index];

    normalizeComponents(partition);

    const std::string partitionId {
      definition.id
    };

    writeGraph(
      region + "-" + partitionId,
      std::move(partition),
      outputDirectory / partitionId
    );

    manifest["partitions"].push_back({
      {"id", partitionId},
      {
        "bounds",
        {
          definition.bounds.left,
          definition.bounds.bottom,
          definition.bounds.right,
          definition.bounds.top
        }
      },
      {
        "assets",
        {
          {
            "metadata",
            partitionId +
              "/metadata.json"
          },
          {
            "nodes",
            partitionId +
              "/nodes.bin"
          },
          {
            "edges",
            partitionId +
              "/edges.bin"
          },
          {
            "geometry",
            partitionId +
              "/geometry.bin"
          },
          {
            "roads",
            partitionId +
              "/roads.bin"
          },
          {
            "strings",
            partitionId +
              "/strings.bin"
          },
          {
            "restrictions",
            partitionId +
              "/restrictions.bin"
          },
          {
            "spatialIndex",
            partitionId +
              "/spatial-index.bin"
          }
        }
      }
    });
  }

  const fs::path manifestPath =
    outputDirectory / "manifest.json";

  std::ofstream manifestStream {
    manifestPath
  };

  requireStream(
    manifestStream,
    manifestPath
  );

  manifestStream
    << manifest.dump(2)
    << '\n';

  requireStream(
    manifestStream,
    manifestPath
  );
}

}

void RoutingWriter::write(
  const std::string& region,
  RoadGraph graph,
  const fs::path& outputDirectory
) {
  if (region == "portugal") {
    writePortugalPartitions(
      region,
      std::move(graph),
      outputDirectory
    );

    return;
  }

  writeGraph(
    region,
    std::move(graph),
    outputDirectory
  );
}

}
